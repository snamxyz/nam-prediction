// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./UserEscrow.sol";
import "./interfaces/IVaultRouter.sol";

/// @dev Minimal view into MarketFactory needed to validate trade pools.
interface IMarketFactoryView {
    function isPool(address pool) external view returns (bool);
}

/// @dev Minimal interface for the LMSR range pool's delegated-trade entrypoints.
interface IRangeLMSR {
    function buyFor(uint256 rangeIndex, uint256 usdcIn, address recipient) external returns (uint256 sharesOut);
    function buyFor(
        uint256 rangeIndex,
        uint256 usdcIn,
        address recipient,
        uint256 minSharesOut
    ) external returns (uint256 sharesOut);
    function sellFor(uint256 rangeIndex, uint256 sharesIn, address seller) external returns (uint256 usdcOut);
}

/// @title Vault — Router for per-user escrows (fund segregation by design)
/// @notice Each depositing user gets their own EIP-1167 minimal-proxy `UserEscrow`
///         contract. The router never custodies user collateral: deposits land
///         directly in the escrow via a single transferFrom, and trades are
///         dispatched into the specific escrow of the trading user.
/// @dev Architectural guarantees:
///       - Router cannot move USDC between users — it never holds any.
///       - Operator cannot drain an escrow to an arbitrary recipient — withdraws
///         always go to the escrow's owner and buys always mint to the owner.
///       - Operator cannot target a sham AMM — executeBuy/Sell* check the pool
///         against `MarketFactory.isPool(pool)`.
contract Vault is IVaultRouter, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Clones for address;

    // ─── State ───
    address public admin;
    address public operator;     // Backend wallet that executes trades
    address public collateral;   // USDC
    address public escrowImpl;   // UserEscrow implementation for cloning
    address public marketFactory; // Optional: pool whitelist source

    /// @notice Extra whitelist for range LMSR pools (not created by MarketFactory).
    ///         Admin-managed; set to true when a new range pool is deployed.
    mapping(address => bool) public whitelistedPools;

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
    event MarketFactoryChanged(address indexed factory);
    event PoolWhitelisted(address indexed pool, bool whitelisted);
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
        address escrowImpl_
    ) {
        require(collateral_ != address(0), "Zero collateral");
        require(operator_ != address(0), "Zero operator");
        require(escrowImpl_ != address(0), "Zero escrow impl");

        admin = msg.sender;
        collateral = collateral_;
        operator = operator_;
        escrowImpl = escrowImpl_;
    }

    // ─── User Functions ───

    /// @notice Deposit USDC into the sender's personal escrow. Creates the escrow on first deposit.
    /// @param amount Amount of USDC to deposit (6 decimals)
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
    /// @param amount Amount of USDC to withdraw (6 decimals)
    function withdraw(uint256 amount) external nonReentrant {
        require(amount > 0, "Zero amount");
        address escrow = escrowOf[msg.sender];
        require(escrow != address(0), "No escrow");

        // Escrow always transfers to its owner (the caller here), regardless
        // of who calls withdraw() on the escrow.
        UserEscrow(escrow).withdraw(amount);
        _debitTotalVaultBalance(amount);

        emit Withdraw(msg.sender, amount);
        emit BalanceUpdated(msg.sender, UserEscrow(escrow).balance());
    }

    // ─── Operator Functions (backend executes trades) ───

    /// @notice Execute a YES buy on behalf of a user against a whitelisted CPMM pool.
    function executeBuyYes(
        address pool,
        uint256 usdcAmount,
        uint256 minSharesOut,
        address user
    ) external onlyOperator nonReentrant notInEmergencyRefundMode {
        address escrow = _requireEscrow(user);
        _requireWhitelistedPool(pool);

        UserEscrow(escrow).buyYesFor(pool, usdcAmount, minSharesOut, user);
        _debitTotalVaultBalance(usdcAmount);

        emit BalanceUpdated(user, UserEscrow(escrow).balance());
    }

    /// @notice Execute a NO buy on behalf of a user against a whitelisted CPMM pool.
    function executeBuyNo(
        address pool,
        uint256 usdcAmount,
        uint256 minSharesOut,
        address user
    ) external onlyOperator nonReentrant notInEmergencyRefundMode {
        address escrow = _requireEscrow(user);
        _requireWhitelistedPool(pool);

        UserEscrow(escrow).buyNoFor(pool, usdcAmount, minSharesOut, user);
        _debitTotalVaultBalance(usdcAmount);

        emit BalanceUpdated(user, UserEscrow(escrow).balance());
    }

    /// @notice Execute a YES sell on behalf of a user; proceeds credited to the user's escrow.
    function executeSellYes(
        address pool,
        uint256 sharesIn,
        uint256 minUsdcOut,
        address user
    ) external onlyOperator nonReentrant notInEmergencyRefundMode {
        address escrow = _requireEscrow(user);
        _requireWhitelistedPool(pool);

        uint256 usdcOut = UserEscrow(escrow).sellYesFor(pool, sharesIn, minUsdcOut, user);
        totalVaultBalance += usdcOut;

        emit BalanceUpdated(user, UserEscrow(escrow).balance());
    }

    /// @notice Execute a NO sell on behalf of a user; proceeds credited to the user's escrow.
    function executeSellNo(
        address pool,
        uint256 sharesIn,
        uint256 minUsdcOut,
        address user
    ) external onlyOperator nonReentrant notInEmergencyRefundMode {
        address escrow = _requireEscrow(user);
        _requireWhitelistedPool(pool);

        uint256 usdcOut = UserEscrow(escrow).sellNoFor(pool, sharesIn, minUsdcOut, user);
        totalVaultBalance += usdcOut;

        emit BalanceUpdated(user, UserEscrow(escrow).balance());
    }

    // ─── Range Operator Functions ───

    /// @notice Buy range outcome tokens on behalf of a user against a whitelisted LMSR pool.
    /// @param pool       RangeLMSR pool address.
    /// @param rangeIndex Outcome index to buy.
    /// @param usdcAmount USDC to spend (6 decimals).
    /// @param user       User on whose behalf the trade is executed.
    function executeRangeBuy(
        address pool,
        uint256 rangeIndex,
        uint256 usdcAmount,
        address user
    ) external onlyOperator nonReentrant notInEmergencyRefundMode {
        address escrow = _requireEscrow(user);
        _requireWhitelistedPool(pool);

        UserEscrow(escrow).buyRangeFor(pool, rangeIndex, usdcAmount, user);
        _debitTotalVaultBalance(usdcAmount);

        emit BalanceUpdated(user, UserEscrow(escrow).balance());
    }

    /// @notice Buy range outcome tokens with a minimum shares-out slippage guard.
    function executeRangeBuy(
        address pool,
        uint256 rangeIndex,
        uint256 usdcAmount,
        address user,
        uint256 minSharesOut
    ) external onlyOperator nonReentrant notInEmergencyRefundMode {
        address escrow = _requireEscrow(user);
        _requireWhitelistedPool(pool);

        UserEscrow(escrow).buyRangeFor(pool, rangeIndex, usdcAmount, user, minSharesOut);
        _debitTotalVaultBalance(usdcAmount);

        emit BalanceUpdated(user, UserEscrow(escrow).balance());
    }

    /// @notice Sell range outcome tokens on behalf of a user; USDC proceeds land in the escrow.
    /// @param pool       RangeLMSR pool address.
    /// @param rangeIndex Outcome index to sell.
    /// @param sharesIn   Shares to burn (18 decimals).
    /// @param user       User on whose behalf the trade is executed.
    function executeRangeSell(
        address pool,
        uint256 rangeIndex,
        uint256 sharesIn,
        address user
    ) external onlyOperator nonReentrant notInEmergencyRefundMode {
        address escrow = _requireEscrow(user);
        _requireWhitelistedPool(pool);

        uint256 usdcOut = UserEscrow(escrow).sellRangeFor(pool, rangeIndex, sharesIn, user);
        totalVaultBalance += usdcOut;

        emit BalanceUpdated(user, UserEscrow(escrow).balance());
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

    /// @notice Set the MarketFactory used as the pool whitelist source.
    /// @dev Pool validation is skipped if this is address(0), useful during local
    ///      testing — production deployments MUST set this to the real factory.
    function setMarketFactory(address factory_) external onlyAdmin {
        marketFactory = factory_;
        emit MarketFactoryChanged(factory_);
    }

    /// @notice Whitelist or de-whitelist a range LMSR pool.
    ///         Called by admin (or operator) after each new range market is deployed.
    function whitelistPool(address pool, bool flag) external onlyAdmin {
        whitelistedPools[pool] = flag;
        emit PoolWhitelisted(pool, flag);
    }

    function setEmergencyRefundMode(bool enabled) external onlyAdmin {
        emergencyRefundMode = enabled;
        emit EmergencyRefundModeChanged(enabled);
    }

    /// @notice Refund current escrow balances to depositor wallets in gas-bounded batches.
    /// @dev Enable emergency mode first so deposits and trades cannot race the batch.
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
        _requireWhitelistedPool(msg.sender);
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
    /// @dev Preserves the existing `balances(address)` selector used by the API/ABI.
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

    function _requireWhitelistedPool(address pool) internal view {
        // Allow range pools explicitly whitelisted by admin
        if (whitelistedPools[pool]) return;
        // Fall through to MarketFactory whitelist for binary CPMM pools
        address factory = marketFactory;
        if (factory == address(0)) return; // Whitelist disabled (local/testing)
        require(IMarketFactoryView(factory).isPool(pool), "Pool not whitelisted");
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
