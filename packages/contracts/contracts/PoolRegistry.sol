// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IPoolRegistry.sol";

interface IPoolFactoryView {
    function isPool(address pool) external view returns (bool);
}

/// @title PoolRegistry
/// @notice Aggregates pool authorization across multiple market factories.
contract PoolRegistry is IPoolRegistry {
    address public admin;

    address[] private factories;
    mapping(address => bool) public isFactory;
    mapping(address => bool) public directPools;

    event AdminChanged(address indexed admin);
    event FactorySet(address indexed factory, bool authorized);
    event DirectPoolSet(address indexed pool, bool authorized);

    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }

    constructor() {
        admin = msg.sender;
    }

    function setAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "Zero admin");
        admin = newAdmin;
        emit AdminChanged(newAdmin);
    }

    function setFactory(address factory, bool authorized) external onlyAdmin {
        require(factory != address(0), "Zero factory");
        if (authorized && !isFactory[factory]) {
            factories.push(factory);
        }
        isFactory[factory] = authorized;
        emit FactorySet(factory, authorized);
    }

    function setDirectPool(address pool, bool authorized) external onlyAdmin {
        require(pool != address(0), "Zero pool");
        directPools[pool] = authorized;
        emit DirectPoolSet(pool, authorized);
    }

    function factoryCount() external view returns (uint256) {
        return factories.length;
    }

    function factoryAt(uint256 index) external view returns (address) {
        return factories[index];
    }

    function isPool(address pool) external view override returns (bool) {
        if (directPools[pool]) return true;

        uint256 length = factories.length;
        for (uint256 i = 0; i < length; i++) {
            address factory = factories[i];
            if (!isFactory[factory]) continue;

            try IPoolFactoryView(factory).isPool(pool) returns (bool ok) {
                if (ok) return true;
            } catch {
                // Ignore misconfigured factories so one bad entry does not brick validation.
            }
        }

        return false;
    }
}
