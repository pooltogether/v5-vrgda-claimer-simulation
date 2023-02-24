#!/usr/bin/env node
const chalk = require('chalk')
const { program } = require('commander')
const fs = require('fs').promises;
const createReadStream = require('fs').createReadStream;
const { parse } = require("csv-parse");
const { formatEther, parseEther, parseUnits, toBigInt } = require('ethers')

const command = async function (options) {
    function log() {
        if (!options.csv) {
            console.log(...arguments)
        }
    }

    function logv() {
        if (!options.csv && options.verbosity) {
            console.log(...arguments)
        }
    }

    const gasPrices = await new Promise((resolve, reject) => {
        let data = []
        createReadStream(options.gasFile)
        .pipe(parse({ delimiter: ",", from_line: 2 }))
        .on("data", function (row) {
            data.push(parseFloat(row[0]))
        })
        .on("end", function () {
            resolve(data)
        })
        .on('error', error => reject(error))
    });
    const decayConstant = Math.log(parseFloat(options.decayPercent))
    const targetPrice = parseFloat(options.targetPrice)
    const count = parseInt(options.count)
    const fraction = parseFloat(options.fraction)
    const linearVrgdaPerTimeUnit = count / (fraction*gasPrices.length)
    const minimumProfit = parseEther(''+options.minimumProfit)
    const claimGas = parseInt(options.claimGas)

    function getTargetSaleTime(numberSold) {
        return parseInt(numberSold / linearVrgdaPerTimeUnit);
    }

    function getVrgdaPrice(timeSinceStart, numberSold) {
        // if (timeSinceStart > 21) { console.log({targetPrice, decayConstant, timeSinceStart, numberSold, targetSaleTime: getTargetSaleTime(numberSold+1)}) }
        const exponent = decayConstant * (timeSinceStart - getTargetSaleTime(numberSold+1))
        const exp = Math.exp(exponent)
        // console.log({exponent, exp, timeSinceStart, saleTime: getTargetSaleTime(numberSold+1)})
        return BigInt(Math.round(targetPrice * exp * 1e18))
    }

    let sold = 0
    let currentTime = 0

    function computeCost(numberOfClaims, gasPrice) {
        const totalGas = numberOfClaims * claimGas
        const gasPriceWei = parseUnits(''+gasPrice, 'gwei') 
        // console.log(`totalGas: ${totalGas} for ${numberOfClaims}, with gas price: ${gasPriceWei}`)
        return toBigInt(totalGas)*gasPriceWei
    }

    function computeRevenue(numberOfClaims) {
        let revenue = BigInt(0)
        for (var i = 0; i < numberOfClaims; i++) {
            revenue += getVrgdaPrice(currentTime, sold + i)
        }
        return revenue
    }

    function computeMaxProfitableClaimCount(gasPrice) {
        const remaining = count - sold
        let chunkSize
        let iterations = 100
        if (remaining < 100) {
            chunkSize = 1
            iterations = remaining
        } else {
            chunkSize = parseInt(remaining / 100)
        }
        let profit = 0;
        let claimCount = 0;
        let cost = 0;
        let revenue = 0;
        for (let i = 1; i <= iterations; i++) {
            let count = i*chunkSize
            let currentCost = computeCost(count, gasPrice)
            let currentRevenue = computeRevenue(count, gasPrice)
            let currentProfit = currentRevenue - currentCost
            if (currentProfit > profit) {
                profit = currentProfit
                claimCount = count
                cost = currentCost
                revenue = currentRevenue
            }
        }
        return [claimCount, profit, cost, revenue]
    }

    // simulate

    let claimHistory = []
    
    gasPrices.forEach(gasPrice => {
        const currentPrice = getVrgdaPrice(currentTime, sold)
        logv(`Checking @${currentTime} sold: ${sold}, gasPrice: ${gasPrice} currentPrice: ${currentPrice}`)

        const [claimCount, profit, cost, revenue] = computeMaxProfitableClaimCount(gasPrice)
        // log(`check: ${claimCount}, reamining: ${count - sold} profit: ${formatEther(profit)}, cost: ${formatEther(cost)}`)
        if (claimCount > 0 && profit > minimumProfit) {
            console.log(chalk.dim(`@${currentTime}: Claimed ${claimCount} with profit ${formatEther(profit)} after cost of ${formatEther(cost)} with cost per claim: ${formatEther(revenue / BigInt(claimCount))}`))
            claimHistory.push({
                time: currentTime,
                count: claimCount,
                profit: profit,
                cost,
                revenue
            })
            sold += claimCount
        }



        currentTime++;
    })

    console.log(chalk.green(`Done! sold ${sold} out of ${options.count}`))

    console.log(chalk.cyan(`Normal claim gas cost (at time 0): ${formatEther(BigInt(claimGas) * parseUnits(''+gasPrices[0], 'gwei'))}`))

}

program.option('-f, --fraction <number>', 'Fraction of the duration that tickets must be claimed by', 0.5)
program.option('-v, --verbosity', 'Verbose logging', false)
program.option('-c, --count <number>', 'The number of claims', 2000)
program.option('-d, --decayPercent <number>', 'The percentage rate of price change per unit time', 1.3)
program.option('-t, --targetPrice <number>', 'The target price', 0.00000001)
program.option('-cg, --claimGas <number>', 'The gas usage of each claim transaction', 200_000)
program.option('-m, --minimumProfit <number>', 'The minimum claim profit in ether', 0.001)
program.requiredOption('-gf, --gasFile <filepath>', 'CSV to use for gas prices, where each row is <gas gwei integer>')

program.action(command)

program.parse()
