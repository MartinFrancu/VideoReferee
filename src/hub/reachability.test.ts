import { describe, expect, it } from 'vitest';

import { certificateNames, joinHost, uncoveredAddresses } from './reachability.js';

describe('joinHost', () => {
  const port = 3000;

  it('keeps a LAN address the operator already used', () => {
    expect(joinHost({ requestHost: '192.168.1.3:3000', addresses: ['192.168.1.3'], port })).toBe(
      '192.168.1.3:3000'
    );
  });

  /**
   * The trap this exists for. Opening the hub at localhost on the laptop works
   * perfectly, so nothing looks wrong — but a QR pointing at localhost sends
   * every phone to itself, and no camera can ever join.
   */
  it('replaces localhost with an address a phone can reach', () => {
    expect(joinHost({ requestHost: 'localhost:3000', addresses: ['192.168.1.3'], port })).toBe(
      '192.168.1.3:3000'
    );
  });

  it('replaces the loopback address too', () => {
    expect(joinHost({ requestHost: '127.0.0.1:3000', addresses: ['192.168.1.3'], port })).toBe(
      '192.168.1.3:3000'
    );
  });

  it('replaces a loopback reached over IPv6', () => {
    expect(joinHost({ requestHost: '[::1]:3000', addresses: ['192.168.1.3'], port })).toBe(
      '192.168.1.3:3000'
    );
  });

  it('replaces a hostname the phones would not resolve', () => {
    expect(joinHost({ requestHost: 'marci-laptop:3000', addresses: ['192.168.1.3'], port })).toBe(
      '192.168.1.3:3000'
    );
  });

  it('always answers on the port the hub is listening on', () => {
    expect(joinHost({ requestHost: 'localhost', addresses: ['192.168.1.3'], port: 8443 })).toBe(
      '192.168.1.3:8443'
    );
  });

  // Including when the address is kept: a host arriving without a port would
  // otherwise send the phone to 443.
  it('adds the port to an address that came without one', () => {
    expect(joinHost({ requestHost: '192.168.1.3', addresses: ['192.168.1.3'], port: 3000 })).toBe(
      '192.168.1.3:3000'
    );
  });

  // Deterministic, so two cameras added a minute apart get the same address.
  it('picks the first address when the laptop has several', () => {
    expect(
      joinHost({ requestHost: 'localhost:3000', addresses: ['192.168.1.3', '10.0.0.57'], port })
    ).toBe('192.168.1.3:3000');
  });

  /**
   * With Wi-Fi and ethernet both up there is no way to tell which network the
   * phones are on, so the address the operator deliberately typed is the best
   * signal there is — even when it is not the first one listed.
   */
  it('keeps the address the operator chose over the first one listed', () => {
    expect(
      joinHost({ requestHost: '10.0.0.57:3000', addresses: ['192.168.1.3', '10.0.0.57'], port })
    ).toBe('10.0.0.57:3000');
  });

  describe('when there is no local address at all', () => {
    it('falls back to whatever the operator used', () => {
      expect(joinHost({ requestHost: 'localhost:3000', addresses: [], port })).toBe('localhost:3000');
    });

    it('and to the listening port when even that is missing', () => {
      expect(joinHost({ requestHost: undefined, addresses: [], port })).toBe('localhost:3000');
    });
  });
});

describe('certificateNames', () => {
  it('reads the names out of what node reports', () => {
    expect(certificateNames('DNS:localhost, IP Address:127.0.0.1, IP Address:192.0.2.2')).toEqual([
      'localhost',
      '127.0.0.1',
      '192.0.2.2',
    ]);
  });

  it('copes with a certificate that lists nothing', () => {
    expect(certificateNames(undefined)).toEqual([]);
    expect(certificateNames('')).toEqual([]);
  });
});

describe('uncoveredAddresses', () => {
  /**
   * A certificate names the addresses it is good for. Move the laptop to
   * another network and its new address is not among them, so every phone is
   * asked to accept the certificate again — the exception it stored was for the
   * old address, which is a different site as far as the phone is concerned.
   */
  it('names an address the certificate does not cover', () => {
    expect(
      uncoveredAddresses({
        addresses: ['10.0.0.57'],
        subjectAltName: 'DNS:localhost, IP Address:127.0.0.1, IP Address:192.168.1.3',
      })
    ).toEqual(['10.0.0.57']);
  });

  it('says nothing when every address is covered', () => {
    expect(
      uncoveredAddresses({
        addresses: ['192.168.1.3'],
        subjectAltName: 'DNS:localhost, IP Address:127.0.0.1, IP Address:192.168.1.3',
      })
    ).toEqual([]);
  });

  it('reports only the addresses that are missing', () => {
    expect(
      uncoveredAddresses({
        addresses: ['192.168.1.3', '10.0.0.57'],
        subjectAltName: 'IP Address:192.168.1.3',
      })
    ).toEqual(['10.0.0.57']);
  });

  // No certificate to compare against is not the same as a mismatch.
  it('claims nothing is missing when it cannot read the certificate', () => {
    expect(uncoveredAddresses({ addresses: ['10.0.0.57'], subjectAltName: undefined })).toEqual([]);
  });
});
