import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import {
  SAN_TYPE_DNS,
  SAN_TYPE_IP,
  assertSanMatches,
  buildSanAltNames,
  formatSubjectAltNameDisplay,
  normalizeAndValidateDnsNames,
  normalizeAndValidateIps,
} from './san';

describe('SAN rules', () => {
  it('keeps multiple IPv4 addresses as IP Address entries, never DNS', () => {
    const ips = ['192.168.99.242', '192.168.99.243', '192.168.99.244'];
    const altNames = buildSanAltNames(ips);

    assert.equal(altNames.length, 3);
    assert.deepEqual(
      altNames,
      ips.map((ip) => ({ type: SAN_TYPE_IP, ip })),
    );
    for (const entry of altNames) {
      assert.equal(entry.type, SAN_TYPE_IP);
      assert.equal('value' in entry && entry.value !== undefined, false);
    }
  });

  it('formats the Subject Alternative Name block with IP Address lines', () => {
    const display = formatSubjectAltNameDisplay([
      '192.168.99.242',
      '192.168.99.243',
      '192.168.99.244',
    ]);

    assert.equal(
      display,
      [
        'Subject Alternative Name:',
        '    IP Address: 192.168.99.242',
        '    IP Address: 192.168.99.243',
        '    IP Address: 192.168.99.244',
      ].join('\n'),
    );
  });

  it('appends optional DNS names after IP Address entries', () => {
    const altNames = buildSanAltNames(['192.168.99.242'], ['app.local']);
    assert.deepEqual(altNames, [
      { type: SAN_TYPE_IP, ip: '192.168.99.242' },
      { type: SAN_TYPE_DNS, value: 'app.local' },
    ]);
    assert.equal(
      formatSubjectAltNameDisplay(['192.168.99.242'], ['app.local']),
      [
        'Subject Alternative Name:',
        '    IP Address: 192.168.99.242',
        '    DNS: app.local',
      ].join('\n'),
    );
  });

  it('rejects ports in IP SAN values', () => {
    assert.throws(
      () => normalizeAndValidateIps(['192.168.99.242:3089']),
      (error: unknown) =>
        error instanceof BadRequestException &&
        String((error as BadRequestException).message).includes('端口'),
    );
    assert.throws(
      () => normalizeAndValidateIps(['[2001:db8::1]:443']),
      (error: unknown) => error instanceof BadRequestException,
    );
  });

  it('rejects hostnames in the IP list so they cannot be written as fake IPs', () => {
    assert.throws(
      () => normalizeAndValidateIps(['example.local']),
      (error: unknown) => error instanceof BadRequestException,
    );
  });

  it('rejects IP addresses placed in the DNS list', () => {
    assert.throws(
      () => normalizeAndValidateDnsNames(['192.168.99.242']),
      (error: unknown) =>
        error instanceof BadRequestException &&
        String((error as BadRequestException).message).includes('IP Address'),
    );
  });

  it('deduplicates IPs and requires at least one', () => {
    assert.deepEqual(normalizeAndValidateIps([' 192.168.99.242 ', '192.168.99.242']), [
      '192.168.99.242',
    ]);
    assert.throws(
      () => normalizeAndValidateIps([]),
      (error: unknown) => error instanceof BadRequestException,
    );
    assert.throws(
      () => normalizeAndValidateIps(['  ', '']),
      (error: unknown) => error instanceof BadRequestException,
    );
  });

  it('flags a mismatch when an IP was encoded as DNS', () => {
    const result = assertSanMatches(
      {
        ips: [],
        dnsNames: ['192.168.99.242'],
        display: '',
        hasIpEncodedAsDns: true,
        raw: [{ type: SAN_TYPE_DNS, value: '192.168.99.242' }],
      },
      { ips: ['192.168.99.242'], dnsNames: [] },
    );
    assert.equal(result.ok, false);
    assert.ok(result.messages.some((message) => message.includes('DNS')));
  });
});
