// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ICPMM {
    function initialize(
        uint256 marketId_,
        address yesToken_,
        address noToken_,
        address collateral_,
        uint256 feeBps_,
        address factory_,
        address feeWallet_,
        uint256 protocolFeeBps_,
        uint256 claimsBufferBps_
    ) external;

    function setVault(address vault_) external;

    function buyYes(uint256 usdcIn) external returns (uint256 sharesOut);
    function buyNo(uint256 usdcIn) external returns (uint256 sharesOut);
    function sellYes(uint256 sharesIn) external returns (uint256 usdcOut);
    function sellNo(uint256 sharesIn) external returns (uint256 usdcOut);

    function buyYesFor(uint256 usdcIn, uint256 minSharesOut, address recipient) external returns (uint256 sharesOut);
    function buyNoFor(uint256 usdcIn, uint256 minSharesOut, address recipient) external returns (uint256 sharesOut);
    function sellYesFor(uint256 sharesIn, uint256 minUsdcOut, address seller) external returns (uint256 usdcOut);
    function sellNoFor(uint256 sharesIn, uint256 minUsdcOut, address seller) external returns (uint256 usdcOut);
    function quoteBuy(bool isYes, uint256 usdcIn) external view returns (uint256 sharesOut);
    function quoteSell(bool isYes, uint256 sharesIn) external view returns (uint256 usdcOut);

    function redeemFor(address user, bool yesWins) external returns (uint256 usdcOut);

    function onResolved(bool yesWins) external;
    function withdrawExcessLiquidity(address treasury) external returns (uint256 amount);
    function getOutstandingWinningClaims() external view returns (uint256);
    function getWithdrawableLiquidity() external view returns (uint256);
    function setFeeWallet(address newFeeWallet) external;
    function setProtocolFeeBps(uint256 newFeeBps) external;
    function setClaimsBufferBps(uint256 newBufferBps) external;
    function claimsBufferBps() external view returns (uint256);

    function addLiquidity(uint256 usdcAmount) external returns (uint256 lpShares);
    function removeLiquidity(uint256 lpShares) external;
    function getPrices() external view returns (uint256 yesPrice, uint256 noPrice);
    function yesReserve() external view returns (uint256);
    function noReserve() external view returns (uint256);
}
