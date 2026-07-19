// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @title BloodOversight
/// @notice Governance and anti-fraud layer for BloodChain. Three jobs:
///
/// 1. ECONOMIC ACCOUNTABILITY. Every organization (blood bank, lab,
///    hospital, transport) posts an HBAR bond when it registers. If an
///    investigation finds it guilty of fraud (e.g. secretly trading a
///    unit instead of transfusing it), the elected authority slashes part
///    of that bond. Enough scandals, or a bond that falls too low, and
///    the org is suspended: it loses its vote and its right to open
///    investigations. This is the "punishment" the chain can actually
///    enforce; criminal or regulatory consequences stay off-chain.
///
/// 2. STAFF TRACEABILITY. Hospitals register the staff (nurses,
///    technicians) who handle testing, as a hash of their staff ID, never
///    the name itself, so no personal data goes on-chain. If a unit's
///    history implicates a specific nurse, the authority can suspend that
///    staff hash, and every future test result tagged with it is
///    rejectable by off-chain checks.
///
/// 3. WEIGHTED DAO ELECTION. The oversight authority itself (the org
///    that resolves investigations) is elected by all registered
///    organizations. Vote weight is computed on-chain from tenure, review
///    score, and scandal count, so a hospital with a fraud history
///    carries less voice than a clean long-standing lab.
///
/// IMPORTANT HONESTY NOTE: this contract cannot see a physical hand-off
/// of blood. What the system detects is the ABSENCE of an expected event
/// (no transfusion or disposal logged within the holding window; see
/// src/checkStaleUnits.js). The investigation verdict itself is a human
/// judgment; the chain records it permanently and enforces the economic
/// consequences automatically.
contract BloodOversight {
    enum OrgType { None, BloodBank, Lab, Hospital, Transport }

    struct Org {
        OrgType orgType;
        uint256 registeredAt;
        uint256 bond;         // remaining bond, in tinybars
        uint256 scandalCount;
        uint256 reviewScore;  // 0-100, set by the authority from off-chain review data
        bool suspended;
        bool exists;
    }

    struct Investigation {
        address subject;
        int64 unitSerial;
        string reason;
        bool resolved;
        bool guilty;
        uint256 penalty;      // tinybars actually slashed
    }

    // NOTE: on Hedera's EVM, msg.value is denominated in tinybars
    // (1 HBAR = 100,000,000 tinybars), so 10 HBAR = 10 * 1e8.
    uint256 public constant MIN_BOND = 10 * 1e8;

    // Graduated punishment settings. A single verdict can never take more
    // than 20% of an org's remaining bond, so one mistake is recoverable
    // and only a pattern of guilt drains the bond.
    uint256 public constant MAX_PENALTY_BPS = 2000; // basis points: 2000 = 20%
    uint256 public constant SUSPEND_SCANDALS = 5;   // suspension after 5 guilty verdicts
    uint256 public constant SUSPEND_BOND_FLOOR = MIN_BOND / 4; // or bond below 2.5 HBAR

    address public authority;                 // current elected oversight org
    mapping(address => Org) public orgs;
    address[] public orgList;

    Investigation[] public investigations;

    mapping(bytes32 => address) public staffEmployer;   // staff ID hash -> employing org
    mapping(bytes32 => bool) public staffSuspended;

    uint256 public electionId;
    bool public electionOpen;
    address[] public currentCandidates;
    mapping(uint256 => mapping(address => uint256)) public tally;  // electionId -> candidate -> weighted votes
    mapping(uint256 => mapping(address => bool)) public voted;     // electionId -> voter -> has voted

    event OrgRegistered(address indexed org, OrgType orgType, uint256 bond);
    event ReviewScoreSet(address indexed org, uint256 score);
    event InvestigationOpened(uint256 indexed id, address indexed subject, int64 unitSerial, string reason);
    event InvestigationResolved(uint256 indexed id, bool guilty, uint256 penalty, bool orgSuspended);
    event BondToppedUp(address indexed org, uint256 amount, uint256 newBond);
    event OrgReinstated(address indexed org, uint256 remainingScandals);
    event StaffRegistered(bytes32 indexed staffHash, address indexed employer);
    event StaffSuspended(bytes32 indexed staffHash);
    event ElectionStarted(uint256 indexed electionId, address[] candidates);
    event VoteCast(uint256 indexed electionId, address indexed voter, address indexed candidate, uint256 weight);
    event AuthorityElected(uint256 indexed electionId, address newAuthority, uint256 winningVotes);

    modifier onlyAuthority() {
        require(msg.sender == authority, "not the oversight authority");
        _;
    }

    modifier onlyRegistered() {
        require(orgs[msg.sender].exists && !orgs[msg.sender].suspended, "not a registered active org");
        _;
    }

    constructor() {
        // Deployer bootstraps as the initial authority until the first
        // election replaces it. Someone has to resolve investigation #0.
        authority = msg.sender;
    }

    /// An organization registers itself and posts its bond in the same
    /// transaction. The bond is the collateral that later slashing bites.
    function registerOrg(uint8 orgType) external payable {
        require(orgType >= 1 && orgType <= 4, "bad org type");
        require(!orgs[msg.sender].exists, "already registered");
        require(msg.value >= MIN_BOND, "bond below minimum");
        orgs[msg.sender] = Org(OrgType(orgType), block.timestamp, msg.value, 0, 50, false, true);
        orgList.push(msg.sender);
        emit OrgRegistered(msg.sender, OrgType(orgType), msg.value);
    }

    /// Review scores come from off-chain data (patient reviews, audit
    /// reports). Only the elected authority may write them on-chain,
    /// acting as the oracle. See OVERSIGHT.md for why this is a
    /// trust-shifting compromise, not a trustless feed.
    function setReviewScore(address org, uint256 score) external onlyAuthority {
        require(orgs[org].exists, "unknown org");
        require(score <= 100, "score is 0-100");
        orgs[org].reviewScore = score;
        emit ReviewScoreSet(org, score);
    }

    /// Any active org (or the authority) can open an investigation, e.g.
    /// when the stale-unit monitor fires for a unit held past the limit.
    function openInvestigation(address subject, int64 unitSerial, string calldata reason)
        external
        returns (uint256 id)
    {
        require(
            msg.sender == authority || (orgs[msg.sender].exists && !orgs[msg.sender].suspended),
            "not allowed to open investigations"
        );
        require(orgs[subject].exists, "unknown subject org");
        investigations.push(Investigation(subject, unitSerial, reason, false, false, 0));
        id = investigations.length - 1;
        emit InvestigationOpened(id, subject, unitSerial, reason);
    }

    /// The authority delivers the verdict. If guilty: slash the bond by
    /// `penalty`, but never more than MAX_PENALTY_BPS of what remains, so
    /// punishment is graduated rather than ruinous. Suspension only after
    /// a sustained pattern (SUSPEND_SCANDALS verdicts) or a bond run down
    /// to SUSPEND_BOND_FLOOR. Slashed funds remain in the contract as an
    /// insurance pool.
    function resolveInvestigation(uint256 id, bool guilty, uint256 penalty) external onlyAuthority {
        Investigation storage inv = investigations[id];
        require(!inv.resolved, "already resolved");
        inv.resolved = true;
        inv.guilty = guilty;
        bool nowSuspended = false;
        if (guilty) {
            Org storage o = orgs[inv.subject];
            uint256 maxSlash = (o.bond * MAX_PENALTY_BPS) / 10000;
            uint256 slash = penalty > maxSlash ? maxSlash : penalty;
            o.bond -= slash;
            inv.penalty = slash;
            o.scandalCount += 1;
            if (o.bond < SUSPEND_BOND_FLOOR || o.scandalCount >= SUSPEND_SCANDALS) {
                o.suspended = true;
                nowSuspended = true;
            }
        }
        emit InvestigationResolved(id, guilty, inv.penalty, nowSuspended);
    }

    /// Rehabilitation, part 1: any registered org can restore its bond by
    /// paying in. Punishment should be recoverable for an org that cleans
    /// up; a permanently crippled participant helps nobody's blood supply.
    function topUpBond() external payable {
        require(orgs[msg.sender].exists, "unknown org");
        require(msg.value > 0, "nothing sent");
        orgs[msg.sender].bond += msg.value;
        emit BondToppedUp(msg.sender, msg.value, orgs[msg.sender].bond);
    }

    /// Rehabilitation, part 2: the authority can reinstate a suspended org
    /// once its bond is back at the minimum. Reinstatement also forgives
    /// one scandal, so a rehabilitated org is not one mistake away from
    /// instant re-suspension. Deliberately a human decision, not automatic:
    /// paying money alone should not buy back trust.
    function reinstateOrg(address org) external onlyAuthority {
        Org storage o = orgs[org];
        require(o.exists && o.suspended, "org not suspended");
        require(o.bond >= MIN_BOND, "bond must be restored to minimum first");
        o.suspended = false;
        if (o.scandalCount > 0) o.scandalCount -= 1;
        emit OrgReinstated(org, o.scandalCount);
    }

    /// Employers register the hash of a staff member's ID. The raw ID
    /// stays off-chain; only the hash is public.
    function registerStaff(bytes32 staffHash) external onlyRegistered {
        require(staffEmployer[staffHash] == address(0), "staff already registered");
        staffEmployer[staffHash] = msg.sender;
        emit StaffRegistered(staffHash, msg.sender);
    }

    function suspendStaff(bytes32 staffHash) external onlyAuthority {
        require(staffEmployer[staffHash] != address(0), "unknown staff");
        staffSuspended[staffHash] = true;
        emit StaffSuspended(staffHash);
    }

    /// Vote weight, computed live at vote time:
    ///   base 10, plus 2 per month of tenure, plus reviewScore/10,
    ///   minus 2 per scandal. Floor of 1 for active orgs (a scandal
    ///   history shrinks your voice but only suspension removes it).
    function voteWeight(address orgAddr) public view returns (uint256) {
        Org storage o = orgs[orgAddr];
        if (!o.exists || o.suspended) return 0;
        uint256 tenureMonths = (block.timestamp - o.registeredAt) / 30 days;
        uint256 base = 10 + (tenureMonths * 2) + (o.reviewScore / 10);
        uint256 malus = o.scandalCount * 2;
        return malus >= base ? 1 : base - malus;
    }

    function startElection(address[] calldata candidates) external onlyAuthority {
        require(!electionOpen, "election already open");
        require(candidates.length >= 2, "need at least 2 candidates");
        electionId += 1;
        currentCandidates = candidates;
        electionOpen = true;
        emit ElectionStarted(electionId, candidates);
    }

    function isCandidate(address a) public view returns (bool) {
        for (uint256 i = 0; i < currentCandidates.length; i++) {
            if (currentCandidates[i] == a) return true;
        }
        return false;
    }

    function castVote(address candidate) external {
        require(electionOpen, "no open election");
        require(!voted[electionId][msg.sender], "already voted");
        require(isCandidate(candidate), "not a candidate");
        uint256 w = voteWeight(msg.sender);
        require(w > 0, "not eligible to vote");
        voted[electionId][msg.sender] = true;
        tally[electionId][candidate] += w;
        emit VoteCast(electionId, msg.sender, candidate, w);
    }

    /// Current authority closes the election and hands over power to the
    /// winner. Yes, an incumbent could refuse to close: see OVERSIGHT.md
    /// limitations. A production version would use a deadline instead.
    function closeElection() external onlyAuthority {
        require(electionOpen, "no open election");
        electionOpen = false;
        address winner = currentCandidates[0];
        uint256 best = tally[electionId][winner];
        for (uint256 i = 1; i < currentCandidates.length; i++) {
            address c = currentCandidates[i];
            if (tally[electionId][c] > best) {
                best = tally[electionId][c];
                winner = c;
            }
        }
        authority = winner;
        emit AuthorityElected(electionId, winner, best);
    }

    function investigationCount() external view returns (uint256) {
        return investigations.length;
    }

    function orgCount() external view returns (uint256) {
        return orgList.length;
    }
}
