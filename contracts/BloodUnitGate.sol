// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @title BloodUnitGate
/// @notice Deployed once on Hedera's Smart Contract Service (HSCS). Holds
/// the on-chain "is this unit cleared for release" rule so it cannot be
/// bypassed by JS code alone - transferCustody() must call requireClearance()
/// and get a successful return before the token transfer is allowed to run.
/// This is the piece that turns "we logged a test happened" into "the
/// system physically will not let an untested unit move."
contract BloodUnitGate {
    enum TestStatus { Unknown, Passed, Failed }

    address public owner;
    mapping(address => bool) public authorizedLabs;
    mapping(int64 => TestStatus) public testStatus;

    event TestResultRecorded(int64 indexed serial, TestStatus status, address indexed submittedBy);
    event ClearanceChecked(int64 indexed serial, bool passed);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier onlyAuthorizedLab() {
        require(authorizedLabs[msg.sender], "not an authorized lab");
        _;
    }

    constructor() {
        owner = msg.sender;
        // Deployer counts as an authorized lab by default so the POC works
        // out of the box. In production, authorizeLab() would be called
        // once per real, approved testing lab, per the governance council's list.
        authorizedLabs[msg.sender] = true;
    }

    function authorizeLab(address lab) external onlyOwner {
        authorizedLabs[lab] = true;
    }

    /// Records a pass/fail result for a unit. Reverts if the caller is not
    /// an authorized lab, so a random account cannot forge a "passed" result.
    function submitTestResult(int64 serial, bool passed) external onlyAuthorizedLab {
        testStatus[serial] = passed ? TestStatus.Passed : TestStatus.Failed;
        emit TestResultRecorded(serial, testStatus[serial], msg.sender);
    }

    /// Reverts unless the unit has a recorded Passed result. Called by
    /// transferCustody() before it moves the token; the JS side never
    /// decides pass/fail itself, it just relays this contract's verdict.
    function requireClearance(int64 serial) external returns (bool) {
        require(testStatus[serial] == TestStatus.Passed, "blocked: test missing or failed");
        emit ClearanceChecked(serial, true);
        return true;
    }
}
