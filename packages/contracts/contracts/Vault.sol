// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./UserEscrow.sol";
import "./interfaces/IMarketAdapter.sol";
import "./interfaces/IPoolRegistry.sol";
import "./interfaces/IVaultRouter.sol";

/// @title Vault — Router for per-user escrows (fund segregation by design)
/// @notice Each depositing user gets their own EIP-1167 minimal-proxy `UserEscrow`.
///         The router never custodies user collateral: deposits land directly in
///         the escrow, and operator trades execute through authorized adapters.
contract Vault is IVaultRouter, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Clones for address;

    // ─── State ───
    address public admin;
    address public operator;     // Backend wallet that executes trades
    address public collateral;   // USDC
    address public escrowImpl;   // UserEscrow implementation for cloning
    address public poolRegistry; // Registry that validates market pools

    mapping(address => bool) public authorizedAdapters;

    /// @notice Current USDC held across all user escrows.
    uint256 public totalVaultBalance;
    /// @notice Locks deposits and operator trades while refunds are being processed.
    bool public emergencyRefundMode;
    /// @notice Users that have ever created an escrow through this vault.
    address[] private depositors;
    mapping(address => bool) public isDepositor;

    /// @inheritdoc IVaultRouter
    mapping(address => address) public override escrowOf;
    /// @inheritdoc IVaultRouter
    mapping(address => bool) public override isEscrow;

    // ─── Events ───
    event EscrowCreated(address indexed user, address indexed escrow);
    event Deposit(address indexed user, uint256 amount);
    event Withdraw(address indexed user, uint256 amount);
    event BalanceUpdated(address indexed user, uint256 newBalance);
    event OperatorChanged(address indexed operator);
    event AdminChanged(address indexed admin);
    event PoolRegistryChanged(address indexed registry);
    event AdapterSet(address indexed adapter, bool authorized);
    event TradeExecuted(address indexed adapter, address indexed pool, address indexed user, int256 collateralDelta);
    event EmergencyRefundModeChanged(bool enabled);
    event EmergencyRefunded(address indexed user, address indexed escrow, uint256 amount);
    event VaultAccountingAdjusted(uint256 trackedBefore, uint256 debitAmount);

    // ─── Modifiers ───
    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }

    modifier onlyOperator() {
        require(msg.sender == operator, "Only operator");
        _;
    }

    modifier notInEmergencyRefundMode() {
        require(!emergencyRefundMode, "Emergency refund active");
        _;
    }

    // ─── Constructor ───
    constructor(
        address collateral_,
        address operator_,
        address escrowImpl_,
        address poolRegistry_
    ) {
        require(collateral_ != address(0), "Zero collateral");
        require(operator_ != address(0), "Zero operator");
        require(escrowImpl_ != address(0), "Zero escrow impl");
        require(poolRegistry_ != address(0), "Zero registry");

        admin = msg.sender;
        collateral = collateral_;
        operator = operator_;
        escrowImpl = escrowImpl_;
        poolRegistry = poolRegistry_;
    }

    // ─── User Functions ───

    /// @notice Deposit USDC into the sender's personal escrow. Creates the escrow on first deposit.
    function deposit(uint256 amount) external nonReentrant notInEmergencyRefundMode {
        require(amount > 0, "Zero amount");

        address escrow = escrowOf[msg.sender];
        if (escrow == address(0)) {
            escrow = _createEscrow(msg.sender);
        }

        // USDC moves directly from user -> escrow. Router never holds collateral.
        IERC20(collateral).safeTransferFrom(msg.sender, escrow, amount);
        totalVaultBalance += amount;

        emit Deposit(msg.sender, amount);
        emit BalanceUpdated(msg.sender, UserEscrow(escrow).balance());
    }

    /// @notice Withdraw USDC from the caller's personal escrow back to the caller.
    function withdraw(uint256 amount) external nonReentrant {
        require(amount > 0, "Zero amount");
        address escrow = _requireEscrow(msg.sender);

        // Escrow always transfers to its owner (the caller here), regardless
        // of who calls withdraw() on the escrow.
        UserEscrow(escrow).withdraw(amount);
        _debitTotalVaultBalance(amount);

        emit Withdraw(msg.sender, amount);
        emit BalanceUpdated(msg.sender, UserEscrow(escrow).balance());
    }

    // ─── Operator Functions ───

    /// @notice Execute a market trade through an authorized adapter.
    function executeTrade(
        address adapter,
        address pool,
        address user,
        bytes calldata tradeData
    ) external onlyOperator nonReentrant notInEmergencyRefundMode returns (bytes memory result) {
        require(authorizedAdapters[adapter], "Adapter not authorized");
        _requireRegisteredPool(pool);

        address escrow = _requireEscrow(user);
        uint256 beforeBalance = UserEscrow(escrow).balance();

        (
            address target,
            address allowanceSpender,
            uint256 allowance,
            bytes memory callData
        ) = IMarketAdapter(adapter).buildTrade(pool, user, tradeData);

        require(target == pool, "Adapter target mismatch");

        result = UserEscrow(escrow).executeCall(target, allowanceSpender, allowance, callData);

        uint256 afterBalance = UserEscrow(escrow).balance();
        int256 delta = _syncTotalVaultBalance(beforeBalance, afterBalance);

        emit TradeExecuted(adapter, pool, user, delta);
        emit BalanceUpdated(user, afterBalance);
    }

    // ─── Admin Functions ───

    function setOperator(address newOperator) external onlyAdmin {
        require(newOperator != address(0), "Zero operator");
        operator = newOperator;
        emit OperatorChanged(newOperator);
    }

    function setAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "Zero admin");
        admin = newAdmin;
        emit AdminChanged(newAdmin);
    }

    function setPoolRegistry(address registry) external onlyAdmin {
        require(registry != address(0), "Zero registry");
        poolRegistry = registry;
        emit PoolRegistryChanged(registry);
    }

    function setAdapter(address adapter, bool authorized) external onlyAdmin {
        require(adapter != address(0), "Zero adapter");
        authorizedAdapters[adapter] = authorized;
        emit AdapterSet(adapter, authorized);
    }

    function setEmergencyRefundMode(bool enabled) external onlyAdmin {
        emergencyRefundMode = enabled;
        emit EmergencyRefundModeChanged(enabled);
    }

    /// @notice Refund current escrow balances to depositor wallets in gas-bounded batches.
    function emergencyRefund(uint256 start, uint256 count)
        external
        onlyAdmin
        nonReentrant
        returns (uint256 refunded, uint256 processed)
    {
        require(emergencyRefundMode, "Emergency refund inactive");

        uint256 length = depositors.length;
        require(start < length, "Start out of bounds");

        uint256 end = start + count;
        if (end > length) end = length;

        for (uint256 i = start; i < end; i++) {
            address user = depositors[i];
            address escrow = escrowOf[user];
            processed++;
            if (escrow == address(0)) continue;

            uint256 balance = UserEscrow(escrow).balance();
            if (balance == 0) continue;

            UserEscrow(escrow).withdraw(balance);
            _debitTotalVaultBalance(balance);
            refunded += balance;

            emit EmergencyRefunded(user, escrow, balance);
            emit BalanceUpdated(user, 0);
        }
    }

    /// @notice Records collateral sent directly from an authorized pool into a user escrow.
    /// @dev Used by redemption flows where the pool pays an existing escrow directly.
    function recordEscrowCredit(address user, uint256 amount) external notInEmergencyRefundMode {
        require(amount > 0, "Zero amount");
        _requireRegisteredPool(msg.sender);
        _requireEscrow(user);

        totalVaultBalance += amount;
        emit BalanceUpdated(user, balanceOf(user));
    }

    // ─── Views ───

    /// @notice USDC balance currently held in `user`'s escrow.
    function balanceOf(address user) public view returns (uint256) {
        address escrow = escrowOf[user];
        if (escrow == address(0)) return 0;
        return UserEscrow(escrow).balance();
    }

    /// @notice Backward-compatible alias for `balanceOf(user)`.
    function balances(address user) external view returns (uint256) {
        return balanceOf(user);
    }

    /// @notice Current USDC balances for a requested set of wallet addresses.
    function balancesOf(address[] calldata users)
        external
        view
        returns (uint256[] memory userBalances, uint256 total)
    {
        userBalances = new uint256[](users.length);
        for (uint256 i = 0; i < users.length; i++) {
            uint256 userBalance = balanceOf(users[i]);
            userBalances[i] = userBalance;
            total += userBalance;
        }
    }

    function depositorCount() external view returns (uint256) {
        return depositors.length;
    }

    function depositorAt(uint256 index) external view returns (address) {
        return depositors[index];
    }

    /// @notice Deterministic preview of the escrow address that will be (or has been) deployed for `user`.
    function predictEscrow(address user) external view returns (address) {
        return escrowImpl.predictDeterministicAddress(_salt(user), address(this));
    }

    // ─── Internal ───

    function _createEscrow(address user) internal returns (address escrow) {
        escrow = escrowImpl.cloneDeterministic(_salt(user));
        UserEscrow(escrow).initialize(user, address(this), collateral);
        escrowOf[user] = escrow;
        isEscrow[escrow] = true;
        if (!isDepositor[user]) {
            isDepositor[user] = true;
            depositors.push(user);
        }
        emit EscrowCreated(user, escrow);
    }

    function _requireEscrow(address user) internal view returns (address escrow) {
        escrow = escrowOf[user];
        require(escrow != address(0), "No escrow");
    }

    function _requireRegisteredPool(address pool) internal view {
        require(pool != address(0), "Zero pool");
        require(IPoolRegistry(poolRegistry).isPool(pool), "Pool not registered");
    }

    function _syncTotalVaultBalance(uint256 beforeBalance, uint256 afterBalance) internal returns (int256) {
        if (afterBalance >= beforeBalance) {
            uint256 credit = afterBalance - beforeBalance;
            totalVaultBalance += credit;
            return int256(credit);
        }

        uint256 debit = beforeBalance - afterBalance;
        _debitTotalVaultBalance(debit);
        return -int256(debit);
    }

    function _debitTotalVaultBalance(uint256 amount) internal {
        uint256 tracked = totalVaultBalance;
        if (tracked >= amount) {
            totalVaultBalance = tracked - amount;
            return;
        }

        totalVaultBalance = 0;
        emit VaultAccountingAdjusted(tracked, amount);
    }

    function _salt(address user) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(user));
    }
}
