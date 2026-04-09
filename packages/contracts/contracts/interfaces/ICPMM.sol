// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ICPMM {
    function initialize(
        uint256 marketId_,
        address yesToken_,
        address noToken_,
        address collateral_,
        uint256 feeBps_,
        address factory_
    ) external;

    function buyYes(uint256 usdcIn) external returns (uint256 sharesOut);
    function buyNo(uint256 usdcIn) external returns (uint256 sharesOut);
    function sellYes(uint256 sharesIn) external returns (uint256 usdcOut);
    function sellNo(uint256 sharesIn) external returns (uint256 usdcOut);
    function addLiquidity(uint256 usdcAmount) external returns (uint256 lpShares);
    function removeLiquidity(uint256 lpShares) external;
    function getPrices() external view returns (uint256 yesPrice, uint256 noPrice);
    function yesReserve() external view returns (uint256);
    function noReserve() external view returns (uint256);
}
