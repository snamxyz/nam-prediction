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

    // ─── Modifiers ───
    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }

    modifier onlyOperator() {
        require(msg.sender == operator, "Only operator");
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
    function deposit(uint256 amount) external nonReentrant {
        require(amount > 0, "Zero amount");

        address escrow = escrowOf[msg.sender];
        if (escrow == address(0)) {
            escrow = _createEscrow(msg.sender);
        }

        // USDC moves directly from user -> escrow. Router never holds collateral.
        IERC20(collateral).safeTransferFrom(msg.sender, escrow, amount);

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

        emit Withdraw(msg.sender, amount);
        emit BalanceUpdated(msg.sender, UserEscrow(escrow).balance());
    }

    // ─── Operator Functions (backend executes trades) ───

    /// @notice Execute a YES buy on behalf of a user against a whitelisted CPMM pool.
    function executeBuyYes(
        address pool,
        uint256 usdcAmount,
        address user
    ) external onlyOperator nonReentrant {
        address escrow = _requireEscrow(user);
        _requireWhitelistedPool(pool);

        UserEscrow(escrow).buyYesFor(pool, usdcAmount, user);

        emit BalanceUpdated(user, UserEscrow(escrow).balance());
    }

    /// @notice Execute a NO buy on behalf of a user against a whitelisted CPMM pool.
    function executeBuyNo(
        address pool,
        uint256 usdcAmount,
        address user
    ) external onlyOperator nonReentrant {
        address escrow = _requireEscrow(user);
        _requireWhitelistedPool(pool);

        UserEscrow(escrow).buyNoFor(pool, usdcAmount, user);

        emit BalanceUpdated(user, UserEscrow(escrow).balance());
    }

    /// @notice Execute a YES sell on behalf of a user; proceeds credited to the user's escrow.
    function executeSellYes(
        address pool,
        uint256 sharesIn,
        address user
    ) external onlyOperator nonReentrant {
        address escrow = _requireEscrow(user);
        _requireWhitelistedPool(pool);

        UserEscrow(escrow).sellYesFor(pool, sharesIn, user);

        emit BalanceUpdated(user, UserEscrow(escrow).balance());
    }

    /// @notice Execute a NO sell on behalf of a user; proceeds credited to the user's escrow.
    function executeSellNo(
        address pool,
        uint256 sharesIn,
        address user
    ) external onlyOperator nonReentrant {
        address escrow = _requireEscrow(user);
        _requireWhitelistedPool(pool);

        UserEscrow(escrow).sellNoFor(pool, sharesIn, user);

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
        emit EscrowCreated(user, escrow);
    }

    function _requireEscrow(address user) internal view returns (address escrow) {
        escrow = escrowOf[user];
        require(escrow != address(0), "No escrow");
    }

    function _requireWhitelistedPool(address pool) internal view {
        address factory = marketFactory;
        if (factory == address(0)) return; // Whitelist disabled (local/testing)
        require(IMarketFactoryView(factory).isPool(pool), "Pool not whitelisted");
    }

    function _salt(address user) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(user));
    }
}
