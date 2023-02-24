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
    const duration = parseInt(options.duration)
    const fraction = parseFloat(options.fraction)
    const linearVrgdaPerTimeUnit = count / (fraction*duration)
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
            const fee = getVrgdaPrice(currentTime, sold + i)
            // console.log(`checking: ${currentTime}, ${sold + i}, ${fee}`)
            // process.exit(1);
            revenue += fee
        }
        return revenue
    }

    function computeMaxProfitableClaimCount(gasPrice) {
        const remaining = count - sold
        let chunkSize
        let maxIterations = 10
        if (remaining < maxIterations) {
            chunkSize = 1
            maxIterations = remaining
        } else {
            chunkSize = parseInt(remaining / maxIterations)
        }
        // console.log(`chunkSize: ${chunkSize}, maxIterations: ${maxIterations}`)
        let profit = 0;
        let claimCount = 0;
        let cost = 0;
        let revenue = 0;
        for (let i = 1; i <= maxIterations; i++) {
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
    
    for (currentTime = 0; currentTime < duration; currentTime++) {
        const currentFee = getVrgdaPrice(currentTime, sold)
        const gasPrice = gasPrices[parseInt(currentTime / duration * gasPrices.length)]
        // logv(`Checking @${currentTime} sold: ${sold}, gasPrice: ${gasPrice} currentFee: ${currentFee}`)

        const [claimCount, profit, cost, revenue] = computeMaxProfitableClaimCount(gasPrice)
        // log(`count: ${claimCount}, profit: ${profit}, cost: ${cost}, revenue: ${revenue}`)
        // log(`check: ${claimCount}, reamining: ${count - sold} profit: ${formatEther(profit)}, cost: ${formatEther(cost)}`)
        if (claimCount > 0 && profit > minimumProfit) {
            sold += claimCount
            console.log(chalk.dim(`@${currentTime}: Total sold: ${sold}/${count} Claimed: ${claimCount} gasPrice: ${gasPrice} with profit ${formatEther(profit)}. Fee per claim: ${formatEther(revenue / BigInt(claimCount))} gas per claim: ${formatEther(parseUnits(""+gasPrice, 'gwei') * BigInt(claimGas))}`))
            claimHistory.push({
                time: currentTime,
                count: claimCount,
                profit: profit,
                cost,
                revenue
            })
        }
    }

    console.log(chalk.green(`Done! sold ${sold} out of ${options.count}`))

    console.log(chalk.cyan(`Normal claim gas cost (at time 0): ${formatEther(BigInt(claimGas) * parseUnits(''+gasPrices[0], 'gwei'))}`))

}

program.option('-f, --fraction <number>', 'Fraction of the duration that tickets must be claimed by', 0.5)
program.option('-v, --verbosity', 'Verbose logging', false)
program.option('-c, --count <number>', 'The number of claims', 2000)
program.option('-d, --decayPercent <number>', 'The percentage rate of price change per unit time', 1.01)
program.option('-du, --duration <number>', 'The time duration over which to run the simulation', 100)
program.option('-t, --targetPrice <number>', 'The target price', 0.0000001)
program.option('-cg, --claimGas <number>', 'The gas usage of each claim transaction', 200_000)
program.option('-m, --minimumProfit <number>', 'The minimum claim profit in ether', 0.000005)
program.requiredOption('-gf, --gasFile <filepath>', 'CSV to use for gas prices, where each row is <gas gwei integer>')

program.action(command)

program.parse()
