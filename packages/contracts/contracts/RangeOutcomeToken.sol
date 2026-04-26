// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title RangeOutcomeToken — ERC20 representing a single range outcome share
/// @dev Deployed as an EIP-1167 minimal proxy per range outcome. `initialize` replaces the constructor.
///      The authorized minter/burner is the LMSR pool contract (not the factory), so the pool can
///      mint/burn directly during buy/sell without an extra call back to the factory.
contract RangeOutcomeToken is ERC20 {
    /// @notice The LMSR pool that is authorized to mint and burn tokens.
    address public pool;
    bool private _initialized;

    string private _tokenName;
    string private _tokenSymbol;

    // Dummy constructor for the implementation contract (clones skip this)
    constructor() ERC20("", "") {}

    /// @notice Initialize the clone — can only be called once
    /// @param name_   ERC-20 name (e.g. "RANGE-0-3")
    /// @param symbol_ ERC-20 symbol (e.g. "RANGE-0-3")
    /// @param pool_   The LMSR pool address authorized to mint and burn
    function initialize(
        string memory name_,
        string memory symbol_,
        address pool_
    ) external {
        require(!_initialized, "Already initialized");
        require(pool_ != address(0), "Zero pool");
        _initialized = true;
        _tokenName = name_;
        _tokenSymbol = symbol_;
        pool = pool_;
    }

    /// @notice Mint tokens — only callable by the authorized pool
    function mint(address to, uint256 amount) external {
        require(msg.sender == pool, "Only pool");
        _mint(to, amount);
    }

    /// @notice Burn tokens — only callable by the authorized pool
    function burn(address from, uint256 amount) external {
        require(msg.sender == pool, "Only pool");
        _burn(from, amount);
    }

    // ─── Override name/symbol since clones can't use constructor args ───

    function name() public view override returns (string memory) {
        return _tokenName;
    }

    function symbol() public view override returns (string memory) {
        return _tokenSymbol;
    }

    function decimals() public pure override returns (uint8) {
        return 18;
    }
}
