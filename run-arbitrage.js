require('dotenv').config() // secret management: private keys stored in the .env file
const Web3 = require('web3'); // connect to web3 

// import from uniswap so smart contracts can work with uniswap protocols
const { ChainId, TokenAmount, Fetcher } = require('@uniswap/sdk');

// poll kyber prices
const abis = require('./abis');
const { mainnet: addresses } = require('./addresses');


const web3 = new Web3(
  new Web3.providers.WebsocketProvider(process.env.INFURA_URL) // secret management key to store websocket address in the .env file
);

web3.eth.accounts.wallet.add(process.env.PRIVATE_KEY) // secret management key to store the private key

// connect to kyber with web3
const kyber = new web3.eth.Contract(
  abis.kyber.kyberNetworkProxy,
  addresses.kyber.kyberNetworkProxy
);

const AMOUNT_ETH = 100; // amount of eth to be borrowed
const RECENT_ETH_PRICE = 230; // current value of eth to dollar as of time of coding this project
const AMOUNT_ETH_WEI = web3.utils.toWei(AMOUNT_ETH.toString()); // value of eth to wei
const AMOUNT_DAI_WEI = web3.utils.toWei((AMOUNT_ETH * RECENT_ETH_PRICE).toString()); // value od eth to dai

// listen to new blocks with websockets to get block number, poll kyber & uniswap prices
const init = async () => {

  // note: uniswap deals with weth NOT eth
  const [dai, weth] = await Promise.all(
    [addresses.tokens.dai, addresses.tokens.weth].map(tokenAddress => (
      Fetcher.fetchTokenData(
        ChainId.MAINNET,
        tokenAddress,
      )
    )));
  daiWeth = await Fetcher.fetchPairData(
    dai,
    weth,
  );

  web3.eth.subscribe('newBlockHeaders')
    .on('data', async block => {
      console.log(`New block received. Block # ${block.number}`);

      // poll kyber results
      const kyberResults = await Promise.all([
        kyber
          .methods
          .getExpectedRate(
            addresses.tokens.dai,
            '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
            AMOUNT_DAI_WEI
          )
          .call(),
        kyber
          .methods
          .getExpectedRate(
            '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
            addresses.tokens.dai,
            AMOUNT_ETH_WEI
          )
          .call()
      ]);

      // normalize kyber results
      const kyberRates = {
        buy: parseFloat(1 / (kyberResults[0].expectedRate / (10 ** 18))),
        sell: parseFloat(kyberResults[1].expectedRate / (10 ** 18))
      };
      console.log('Kyber ETH/DAI');
      console.log(kyberRates);

      // poll uniswap results
      const uniswapResults = await Promise.all([
        daiWeth.getOutputAmount(new TokenAmount(dai, AMOUNT_DAI_WEI)),
        daiWeth.getOutputAmount(new TokenAmount(weth, AMOUNT_ETH_WEI))
      ]);

      // normalize uniswap results
      const uniswapRates = {
        buy: parseFloat(AMOUNT_DAI_WEI / (uniswapResults[0][0].toExact() * 10 ** 18)),
        sell: parseFloat(uniswapResults[1][0].toExact() / AMOUNT_ETH),
      };
      console.log('Uniswap ETH/DAI');
      console.log(uniswapRates);

      const gasPrice = await web3.eth.getGasPrice();
      //200000 is picked arbitrarily, have to be replaced by actual tx cost in next lectures, with Web3 estimateGas()
      const txCost = 200000 * parseInt(gasPrice); // gasPrice needs to be passed as an integer
      const currentEthPrice = (uniswapRates.buy + uniswapRates.sell) / 2;
      const profit1 = (parseInt(AMOUNT_ETH_WEI) / 10 ** 18) * (uniswapRates.sell - kyberRates.buy) - (txCost / 10 ** 18) * currentEthPrice; // 10 ** 18 is to convert from wei to dai (dollars)
      const profit2 = (parseInt(AMOUNT_ETH_WEI) / 10 ** 18) * (kyberRates.sell - uniswapRates.buy) - (txCost / 10 ** 18) * currentEthPrice;

      //Execute arb Kyber <=> Uniswap
      if (profit1 > 0) {
        console.log('Arb opportunity found!');
        console.log(`Buy ETH on Kyber at ${kyberRates.buy} dai`);
        console.log(`Sell ETH on Uniswap at ${uniswapRates.sell} dai`);
        console.log(`Expected profit: ${profit1} dai`);

        //Execute arb Uniswap <=> Kyber        
      } else if (profit2 > 0) {
        console.log('Arb opportunity found!');
        console.log(`Buy ETH from Uniswap at ${uniswapRates.buy} dai`);
        console.log(`Sell ETH from Kyber at ${kyberRates.sell} dai`);
        console.log(`Expected profit: ${profit2} dai`);
      }
      else{
        console.log('Arb not found');
      }
    })
    .on('error', error => {
      console.log(error);
    });

}

init();