# BloodChain: Proof-of-Concept Writeup

Repository: [github.com/easonnshi/bloodchain-poc](https://github.com/easonnshi/bloodchain-poc)

## What this project set out to prove

The BloodChain design doc made two claims that mattered more than the others: that a smart contract could enforce a hard safety rule (block release of a blood unit with a missing or failed test) rather than merely logging that the rule exists, and that flagging one contaminated unit could instantly find and quarantine every other unit from the same donation batch, even units that had already moved to a different party. Everything else in the two-week POC scope exists to support proving those two things with real transactions rather than a description of how they'd theoretically work.

## What was built

A working Node.js project implementing all five core functions from the design doc on Hedera's public testnet: `mintUnit()`, `submitTestResult()`, `transferCustody()`, `closeUnit()`, and `flagBatch()`, backed by an HTS non-fungible token (one NFT per blood unit), an HCS topic (the permanent, timestamped event log), and a deployed Solidity contract, `BloodUnitGate`, that holds the actual pass/fail gate. A local JSON index mirrors on-chain events for fast lookups, and a mirror-node query layer exists for pulling full history back from Hedera directly. Full breakdown of each piece and why it exists is in `README.md` in this repository.

## Steps executed, in order

**1. Project scaffolding.** Set up the Node.js project structure (`src/`, `scripts/`, `contracts/`, `test/`, `data/`), `package.json`, and an `.env.example` template so credentials never get hardcoded into the code itself.

**2. Client configuration.** Built `src/hederaConfig.js`, the single file that reads Hedera credentials from `.env` and constructs the SDK client every other file uses. Purpose: keep credential handling in exactly one place rather than scattered across files.

**3. Token creation.** Ran `scripts/01-createToken.js`, a one-time `TokenCreateTransaction` defining the "blood unit" NFT class itself, with a supply key controlling who can mint/burn units and a wipe key controlling who can forcibly retire one. Purpose: encode "who's allowed to create or destroy a blood-unit token" as a network-enforced rule rather than an internal policy.

*Issue hit:* the first attempt failed with `INSUFFICIENT_TX_FEE`. The client's default max transaction fee was capped at 2 HBAR, too low for what testnet was charging for token creation at the time. Fixed by raising the cap to 20 HBAR in `hederaConfig.js`. Testnet HBAR is free from the faucet, so there's no real cost to the higher ceiling.

**4. Topic creation.** Ran `scripts/02-createTopic.js`, creating the HCS topic that every custody event gets logged to. Purpose: this is the tamper-proof audit trail, ordered and timestamped by network consensus, not something any single party (including the blood bank) can quietly edit after the fact.

**5. Contract compilation and deployment.** Compiled `contracts/BloodUnitGate.sol` with `scripts/compileContract.js`, then deployed it via `scripts/03-deployContract.js`. Purpose: this is the enforcement mechanism — a `requireClearance(serial)` function that reverts unless a unit has a recorded passing test result, called by `transferCustody()` before any token actually moves.

*Issue hit:* deployment failed with `INSUFFICIENT_GAS`. The deploy script requested 300,000 gas, not enough for the network to execute the contract's constructor. Fixed by raising it to 1,000,000.

**6. Party registration.** Ran `scripts/registerAllParties.js`, associating the lab, hospital, and transport testnet accounts with the BLOOD token, a Hedera-specific requirement before any of those accounts can receive the token at all.

**7. Full demo run.** Ran `node demo.js`, executing the entire story end to end on real testnet transactions.

**8. Automated tests.** Ran `node --test`, three tests covering the claims that mattered most: minting works, a failed-test unit is physically blocked from transfer, and flagging one unit correctly quarantines every sibling from its donation batch.

**9. Published to GitHub.** Pushed the finished project to `github.com/easonnshi/bloodchain-poc` using a Personal Access Token for authentication (GitHub no longer accepts account passwords for git operations).

## Results

The demo run minted unit #1, passed its test, and transferred it to the lab account without friction, sequence numbers #1 through #3 in the HCS log. It then minted a sibling unit #2 from the same donation batch, deliberately failed its test, and attempted to transfer it anyway. That transfer was blocked: `transferCustody()` called the contract's `requireClearance()`, the contract reverted because no passing test was on record, and the NFT never left the blood bank's account, logged as `TRANSFER_BLOCKED` at sequence #6. Flagging unit #2 then triggered `flagBatch()`, which searched for every other unit sharing its donor batch ID and found unit #1, even though unit #1 had already been transferred out to the lab, and quarantined it, logged as `BATCH_ALERT` at sequence #8.

The automated test suite confirmed the same three behaviors independently, on freshly minted units: `mintUnit` returned a usable serial number, `transferCustody` returned `blocked: true` for a unit with a failed test, and `flagBatch` correctly quarantined two additional sibling units minted from a shared test batch ID. All three tests passed.

Every transaction referenced above happened on Hedera's public testnet and can be independently verified through the mirror node or on hashscan.io/testnet using the `TOKEN_ID`, `TOPIC_ID`, or `CONTRACT_ID` values from this project's `.env`.

## What this proves, and what it doesn't

This demonstrates that the riskiest technical claims in the design doc are not just plausible, they're implemented and behaving correctly under test: a smart contract can hold real enforcement authority over a physical-world process instead of just recording that a rule was followed, and a batch-level recall can happen instantly and automatically rather than requiring someone to manually trace and locate every affected unit.

It does not demonstrate a production system. This is testnet, funded with free faucet HBAR, using simulated party accounts and fabricated donor batch IDs, not real hospitals, labs, or blood. It also does not solve the problem the design doc names honestly in its own limitations section: if a lab enters an incorrect test result, `submitTestResult()` will faithfully record and enforce that incorrect result exactly as if it were correct. The system proves a record wasn't altered after it was written, not that the record was true when it was written. That gap would need random audits and cross-checks external to the blockchain itself, deliberately out of scope for this two-week proof of concept.
