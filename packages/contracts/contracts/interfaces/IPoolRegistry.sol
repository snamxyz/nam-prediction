// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IPoolRegistry {
    function isPool(address pool) external view returns (bool);
}
