// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

interface IGroth16Verifier {
    function verifyProof(uint256[2] calldata a, uint256[2][2] calldata b, uint256[2] calldata c, uint256[11] calldata pub)
        external view returns (bool);
}

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title Proof Pays
/// @notice Funders lock money against a skill milestone ("machine stitching level 3+, 5 buyer-confirmed orders,
/// family income under 2.5 lakh, girls"). A student is paid when her phone sends a zero-knowledge proof that a
/// credential signed by Disha meets it. The contract checks the proof itself, so neither Disha nor anyone relaying
/// the proof can pay someone who does not qualify, pay twice, or send the money elsewhere.
///
/// Public signals (circuit order): nullifier, issuerAx, issuerAy, milestoneId, subskillIndex, minLevel, minOrders,
/// maxIncomeBand, requiredGender, today, payout.
contract ProofPays {
    struct Milestone {
        address funder;
        string name;
        uint8 subskillIndex;
        uint8 minLevel;
        uint32 minOrders;
        uint8 maxIncomeBand;
        uint8 requiredGender;
        uint256 amount;     // paid per student
        uint256 budget;     // left in escrow
        uint256 paidCount;
        bool open;
    }

    uint256 private constant FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;

    IGroth16Verifier public immutable verifier;
    IERC20 public immutable token;
    uint256 public immutable issuerAx;
    uint256 public immutable issuerAy;

    uint256 public milestoneCount;
    mapping(uint256 => Milestone) public milestones;
    mapping(uint256 => bool) public nullifierUsed;

    event MilestoneFunded(uint256 indexed id, address indexed funder, string name, uint256 amount, uint256 budget);
    event Paid(uint256 indexed milestoneId, uint256 indexed nullifier, address indexed payout, uint256 amount, uint256 day);
    event Closed(uint256 indexed id, uint256 refunded);

    error BadMilestone();
    error NotOpen();
    error AlreadyPaid();
    error OutOfBudget();
    error WrongDay();
    error InvalidProof();
    error NotFunder();
    error TransferFailed();

    constructor(IGroth16Verifier verifier_, IERC20 token_, uint256 issuerAx_, uint256 issuerAy_) {
        verifier = verifier_;
        token = token_;
        issuerAx = issuerAx_;
        issuerAy = issuerAy_;
    }

    /// @notice Lock `budget` tokens to pay `amount` to each student who proves the milestone.
    function createMilestone(
        string calldata name,
        uint8 subskillIndex,
        uint8 minLevel,
        uint32 minOrders,
        uint8 maxIncomeBand,
        uint8 requiredGender,
        uint256 amount,
        uint256 budget
    ) external returns (uint256 id) {
        if (subskillIndex >= 32 || minLevel < 1 || minLevel > 4 || maxIncomeBand > 15 || requiredGender > 3
            || minOrders > 1000 || amount == 0 || budget < amount) revert BadMilestone();
        if (!token.transferFrom(msg.sender, address(this), budget)) revert TransferFailed();
        id = ++milestoneCount;
        milestones[id] = Milestone(msg.sender, name, subskillIndex, minLevel, minOrders, maxIncomeBand, requiredGender,
            amount, budget, 0, true);
        emit MilestoneFunded(id, msg.sender, name, amount, budget);
    }

    /// @notice Pays `payout` once per student per milestone. Anyone may submit (a relayer pays the gas).
    function claim(
        uint256 id,
        address payout,
        uint256 today,
        uint256 nullifier,
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c
    ) external {
        Milestone storage m = milestones[id];
        if (!m.open) revert NotOpen();
        if (nullifierUsed[nullifier] || nullifier >= FIELD) revert AlreadyPaid();
        if (m.budget < m.amount) revert OutOfBudget();
        uint256 chainDay = block.timestamp / 1 days;
        if (today + 1 < chainDay || today > chainDay + 1) revert WrongDay();

        uint256[11] memory pub = [
            nullifier, issuerAx, issuerAy, id, uint256(m.subskillIndex), uint256(m.minLevel), uint256(m.minOrders),
            uint256(m.maxIncomeBand), uint256(m.requiredGender), today, uint256(uint160(payout))
        ];
        if (!verifier.verifyProof(a, b, c, pub)) revert InvalidProof();

        nullifierUsed[nullifier] = true;
        m.budget -= m.amount;
        m.paidCount += 1;
        if (!token.transfer(payout, m.amount)) revert TransferFailed();
        emit Paid(id, nullifier, payout, m.amount, today);
    }

    /// @notice The funder closes a milestone and gets back what was not paid out.
    function close(uint256 id) external {
        Milestone storage m = milestones[id];
        if (msg.sender != m.funder) revert NotFunder();
        if (!m.open) revert NotOpen();
        m.open = false;
        uint256 left = m.budget;
        m.budget = 0;
        if (left > 0 && !token.transfer(m.funder, left)) revert TransferFailed();
        emit Closed(id, left);
    }
}
