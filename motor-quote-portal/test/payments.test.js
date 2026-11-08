import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fiuuPayLink } from '../payments/fiuu.js';

test('Fiuu link: signed with md5(amount + merchant + order + verify key)', () => {
  process.env.FIUU_MERCHANT_ID = 'testmerchant';
  process.env.FIUU_VERIFY_KEY = 'secretkey123';
  const link = new URL(fiuuPayLink({ orderId: 'VBK2281_101500', amount: 2110.6, name: 'Ali', mobile: '012-345 6789', description: 'Car insurance VBK2281' }));
  assert.equal(link.origin + link.pathname, 'https://pay.fiuu.com/RMS/pay/testmerchant/');
  assert.equal(link.searchParams.get('amount'), '2110.60');
  assert.equal(link.searchParams.get('orderid'), 'VBK2281_101500');
  assert.equal(link.searchParams.get('bill_mobile'), '60123456789');
  assert.equal(link.searchParams.get('vcode'), createHash('md5').update('2110.60testmerchantVBK2281_101500secretkey123').digest('hex'));
  assert.throws(() => fiuuPayLink({ orderId: 'X', amount: 0 }), /more than RM0/);
  delete process.env.FIUU_VERIFY_KEY;
  assert.throws(() => fiuuPayLink({ orderId: 'X', amount: 10 }), /Fiuu not set up/);
});
