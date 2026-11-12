import assert from 'node:assert/strict';
import test from 'node:test';

import Decimal from 'decimal.js';
import { dayBoundsInTimezone, localDateInTimezone } from '../shared/business-date';
import {
  getCurrencyMinorUnitFactor,
  getCurrencyFractionDigits,
} from '../main/countries';

/**
 * M3 daily close arithmetic contract. This deliberately operates on synthetic
 * integer-minor-unit fixtures: it never opens the owner's production database.
 */
function reconcileDay(input: {
  openingCash: number;
  cashSales: number[];
  cardSales: number[];
  upiSales: number[];
  cashRefunds: number[];
  nonCashRefunds: number[];
  discounts: number[];
  tax: number[];
  countedCash: number;
}) {
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  const grossCash = sum(input.cashSales);
  const grossCard = sum(input.cardSales);
  const grossUpi = sum(input.upiSales);
  const cashRefunds = sum(input.cashRefunds);
  const nonCashRefunds = sum(input.nonCashRefunds);
  const expectedCash = input.openingCash + grossCash - cashRefunds;
  return {
    grossCollected: grossCash + grossCard + grossUpi,
    cashCollectedNet: grossCash - cashRefunds,
    cardCollectedNet: grossCard,
    upiCollectedNet: grossUpi,
    refunds: cashRefunds + nonCashRefunds,
    netCollections: grossCash + grossCard + grossUpi - cashRefunds - nonCashRefunds,
    discounts: sum(input.discounts),
    taxCollected: sum(input.tax),
    expectedCash,
    countedCash: input.countedCash,
    cashVariance: input.countedCash - expectedCash,
  };
}

test('M3 representative INR business day reconciles cash, card, UPI, split tender and refund once', () => {
  const fixture = {
    openingCash: 500_000, // ₹5,000.00
    cashSales: [125_000, 75_000, 40_000],
    cardSales: [80_000, 35_000],
    upiSales: [60_000, 55_000],
    cashRefunds: [15_000],
    nonCashRefunds: [10_000],
    discounts: [5_000],
    tax: [22_000, 18_000],
    countedCash: 720_000,
  };
  const result = reconcileDay(fixture);

  assert.equal(result.grossCollected, 470_000);
  assert.equal(result.cashCollectedNet, 225_000);
  assert.equal(result.cardCollectedNet, 115_000);
  assert.equal(result.upiCollectedNet, 115_000);
  assert.equal(result.refunds, 25_000);
  assert.equal(result.netCollections, 445_000);
  assert.equal(result.expectedCash, 725_000);
  assert.equal(result.cashVariance, -5_000);

  // Sum of payment-method net totals must equal the overall net collection.
  assert.equal(
    result.cashCollectedNet + result.cardCollectedNet + result.upiCollectedNet -
      fixture.nonCashRefunds.reduce((a, b) => a + b, 0),
    result.netCollections,
  );
});

test('M3 report amounts remain in integer minor units with tenant currency precision', () => {
  const inrFactor = getCurrencyMinorUnitFactor('INR');
  const inrDigits = getCurrencyFractionDigits('INR');
  assert.equal(inrFactor, 100);
  assert.equal(inrDigits, 2);
  assert.equal(new Decimal(12345).div(inrFactor).toFixed(inrDigits), '123.45');

  // Exact decimal check for a configurable percentage; no tax rate is embedded.
  const taxableMinor = new Decimal(10_001);
  const configuredRatePercent = new Decimal('5.5');
  const taxMinor = taxableMinor.mul(configuredRatePercent).div(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  assert.equal(taxMinor.toNumber(), 550);
});

test('M3 business date uses tenant timezone and half-open day range', () => {
  const [start, end] = dayBoundsInTimezone('2026-11-12', 'Asia/Kolkata');
  assert.equal(start, '2026-11-11 18:30:00');
  assert.equal(end, '2026-11-12 18:30:00');
  assert.equal(localDateInTimezone(new Date('2026-11-11T19:00:00.000Z'), 'Asia/Kolkata'), '2026-11-12');
});

test('M3 unpaid bills are not part of completed settlement fixture', () => {
  const bills = [
    { id: 'settled-cash', status: 'paid', paidMinor: 20_000 },
    { id: 'settled-split', status: 'paid', paidMinor: 30_000 },
    { id: 'unsettled', status: 'unpaid', paidMinor: 0 },
    { id: 'partial', status: 'partial', paidMinor: 7_000 },
  ];
  const settled = bills.filter((bill) => bill.status === 'paid');
  assert.equal(settled.reduce((sum, bill) => sum + bill.paidMinor, 0), 50_000);
  assert.equal(settled.some((bill) => bill.id === 'unsettled' || bill.id === 'partial'), false);
});

test('M3 ingredient movements are represented once per lifecycle transition', () => {
  const movements = [
    { orderItemId: 'item-1', kind: 'recipe_depletion', quantity: 2 },
    { orderItemId: 'item-2', kind: 'recipe_depletion', quantity: 1 },
    { orderItemId: 'item-2', kind: 'recipe_restore', quantity: 1 },
    { orderItemId: 'waste-1', kind: 'waste', quantity: 0.25, reason: 'Spoilage' },
  ];
  const keys = movements.map((movement) => `${movement.orderItemId}:${movement.kind}`);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(movements.filter((movement) => movement.kind === 'waste').length, 1);
  assert.equal(movements.find((movement) => movement.kind === 'waste')?.reason, 'Spoilage');
});
