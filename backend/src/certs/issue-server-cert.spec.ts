import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as forge from 'node-forge';
import { SAN_TYPE_DNS, SAN_TYPE_IP, readSanFromCert } from './san';
import {
  generateRsaKeyPair,
  generateSerialNumber,
  issueServerCertificate,
  verifyServerCertificate,
} from './issue-server-cert';

async function createTestCa() {
  const keys = await generateRsaKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = generateSerialNumber();
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 10);
  const attrs = [
    { name: 'countryName', value: 'CN' },
    { name: 'organizationName', value: 'TestOrg' },
    { name: 'commonName', value: 'Test Local Root CA' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', critical: true, cA: true, pathLenConstraint: 0 },
    { name: 'keyUsage', critical: true, keyCertSign: true, cRLSign: true },
    { name: 'subjectKeyIdentifier' },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return { cert, key: keys.privateKey };
}

describe('issueServerCertificate', () => {
  it('encodes every IPv4 SAN as IP Address, not DNS, and displays the confirmed format', async () => {
    const ca = await createTestCa();
    const keys = await generateRsaKeyPair(2048);
    const ips = ['192.168.99.242', '192.168.99.243', '192.168.99.244'];

    const issued = issueServerCertificate({
      caCert: ca.cert,
      caKey: ca.key,
      keys,
      ips,
      serialNumber: generateSerialNumber(),
      days: 397,
      subject: { commonName: '192.168.99.242', organization: 'TestOrg', country: 'CN' },
    });

    const expectedDisplay = [
      'Subject Alternative Name:',
      '    IP Address: 192.168.99.242',
      '    IP Address: 192.168.99.243',
      '    IP Address: 192.168.99.244',
    ].join('\n');
    assert.equal(issued.sanDisplay, expectedDisplay);

    const parsed = readSanFromCert(issued.cert);
    assert.equal(parsed.display, expectedDisplay);
    assert.deepEqual(parsed.ips, ips);
    assert.deepEqual(parsed.dnsNames, []);
    assert.equal(parsed.hasIpEncodedAsDns, false);
    assert.equal(parsed.raw.length, 3);
    for (const [index, entry] of parsed.raw.entries()) {
      assert.equal(entry.type, SAN_TYPE_IP, `SAN entry ${index} must be type 7 (IP Address)`);
      assert.equal(entry.ip, ips[index]);
      assert.notEqual(entry.type, SAN_TYPE_DNS);
    }

    const basic = issued.cert.getExtension('basicConstraints') as { cA?: boolean };
    assert.equal(basic?.cA, false);
    const eku = issued.cert.getExtension('extKeyUsage') as { serverAuth?: boolean };
    assert.equal(eku?.serverAuth, true);

    const verification = verifyServerCertificate({
      cert: issued.cert,
      caCert: ca.cert,
      privateKey: keys.privateKey,
      expectedSan: { ips, dnsNames: [] },
    });
    assert.equal(verification.ok, true);
    assert.equal(verification.sanValid, true);
    assert.equal(verification.chainValid, true);
    assert.equal(verification.keyMatch, true);
    assert.equal(verification.sanDisplay, expectedDisplay);
    assert.deepEqual(verification.messages, []);
  });

  it('can add DNS SAN entries alongside IP Address entries', async () => {
    const ca = await createTestCa();
    const keys = await generateRsaKeyPair(2048);
    const issued = issueServerCertificate({
      caCert: ca.cert,
      caKey: ca.key,
      keys,
      ips: ['10.0.0.8'],
      dnsNames: ['app.local'],
      serialNumber: generateSerialNumber(),
    });

    const parsed = readSanFromCert(issued.cert);
    assert.deepEqual(parsed.raw, [
      { type: SAN_TYPE_IP, ip: '10.0.0.8' },
      { type: SAN_TYPE_DNS, value: 'app.local' },
    ]);
    assert.equal(
      parsed.display,
      [
        'Subject Alternative Name:',
        '    IP Address: 10.0.0.8',
        '    DNS: app.local',
      ].join('\n'),
    );
  });

  it('uses a unique serial and fails verification when the private key does not match', async () => {
    const ca = await createTestCa();
    const keysA = await generateRsaKeyPair(2048);
    const keysB = await generateRsaKeyPair(2048);
    const serials = new Set<string>();
    const first = issueServerCertificate({
      caCert: ca.cert,
      caKey: ca.key,
      keys: keysA,
      ips: ['10.0.0.1'],
      serialNumber: generateSerialNumber(serials),
    });
    serials.add(first.cert.serialNumber);
    const second = issueServerCertificate({
      caCert: ca.cert,
      caKey: ca.key,
      keys: keysA,
      ips: ['10.0.0.2'],
      serialNumber: generateSerialNumber(serials),
    });
    assert.notEqual(String(first.cert.serialNumber), String(second.cert.serialNumber));

    const mismatch = verifyServerCertificate({
      cert: first.cert,
      caCert: ca.cert,
      privateKey: keysB.privateKey,
      expectedSan: { ips: ['10.0.0.1'], dnsNames: [] },
    });
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.keyMatch, false);
  });
});
