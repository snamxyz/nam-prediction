// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title OutcomeToken — ERC20 representing a YES or NO outcome share
/// @dev Deployed as an EIP-1167 minimal proxy. `initialize` replaces the constructor.
contract OutcomeToken is ERC20 {
    address public factory;
    bool private _initialized;

    string private _tokenName;
    string private _tokenSymbol;

    // Dummy constructor for the implementation contract (clones skip this)
    constructor() ERC20("", "") {}

    /// @notice Initialize the clone — can only be called once
    function initialize(
        string memory name_,
        string memory symbol_,
        address factory_
    ) external {
        require(!_initialized, "Already initialized");
        require(factory_ != address(0), "Zero factory");
        _initialized = true;
        _tokenName = name_;
        _tokenSymbol = symbol_;
        factory = factory_;
    }

    /// @notice Mint tokens — only callable by the factory
    function mint(address to, uint256 amount) external {
        require(msg.sender == factory, "Only factory");
        _mint(to, amount);
    }

    /// @notice Burn tokens — only callable by the factory
    function burn(address from, uint256 amount) external {
        require(msg.sender == factory, "Only factory");
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
