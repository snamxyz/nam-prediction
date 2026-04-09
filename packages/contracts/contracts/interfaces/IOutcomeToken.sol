// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IOutcomeToken {
    function initialize(string memory name_, string memory symbol_, address factory_) external;
    function mint(address to, uint256 amount) external;
    function burn(address from, uint256 amount) external;
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}
