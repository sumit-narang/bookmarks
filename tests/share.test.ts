/**
 * Share payload codec contract tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  decodeSharePayload,
  encodeSharePayload,
  isValidSharePayload,
  type SharePayload,
} from '../share/src';

const createSamplePayload = (): SharePayload => {
  return [
    {
      id: 'collection-1',
      name: 'Favorites',
      places: [
        {
          id: 'place-1',
          name: 'Cafe Sunrise',
          type: 'Cafe',
          image: 'https://example.com/cafe.jpg',
          address: '123 Main Street',
          rating: 4.8,
          reviewCount: 124,
        },
      ],
    },
  ];
};

test('encodeSharePayload and decodeSharePayload round-trip a payload', () => {
  const payload = createSamplePayload();

  const encoded = encodeSharePayload(payload);
  const decoded = decodeSharePayload(encoded);

  assert.deepEqual(decoded, payload);
});

test('decodeSharePayload matches payloads encoded by current mobile behavior', () => {
  const payload = createSamplePayload();
  const encodedByMobileLogic = btoa(encodeURIComponent(JSON.stringify(payload)));
  const encodedByModule = encodeSharePayload(payload);

  assert.equal(encodedByModule, encodedByMobileLogic);

  const decodedByMobileLogic = JSON.parse(decodeURIComponent(atob(encodedByModule)));
  assert.deepEqual(decodedByMobileLogic, payload);

  const decoded = decodeSharePayload(encodedByMobileLogic);

  assert.deepEqual(decoded, payload);
});

test('single place share payload round-trips with synthetic collection wrapper', () => {
  const payload: SharePayload = [
    {
      id: 'shared-place',
      name: 'Shared Place',
      places: [
        {
          id: 'place-99',
          name: 'Lone Place',
          type: 'Park',
          image: 'https://example.com/park.jpg',
          address: '99 Green Ave',
          rating: 4.2,
          reviewCount: 19,
        },
      ],
    },
  ];

  const decoded = decodeSharePayload(encodeSharePayload(payload));

  assert.deepEqual(decoded, payload);
});

test('multi-collection payload with multiple places round-trips', () => {
  const payload: SharePayload = [
    {
      id: 'collection-a',
      name: 'Weekend',
      places: [
        {
          id: 'place-a1',
          name: 'Museum',
          rating: 4.5,
          reviewCount: 320,
        },
        {
          id: 'place-a2',
          name: 'Coffee Spot',
          type: 'Cafe',
        },
      ],
    },
    {
      id: 'collection-b',
      name: 'Travel',
      places: [
        {
          id: 'place-b1',
          name: 'Viewpoint',
          address: 'Hill Road',
          image: 'https://example.com/view.jpg',
          rating: 5,
          reviewCount: 900,
        },
      ],
    },
  ];

  const decoded = decodeSharePayload(encodeSharePayload(payload));

  assert.deepEqual(decoded, payload);
});

test('empty collections array round-trips', () => {
  const payload: SharePayload = [];
  const decoded = decodeSharePayload(encodeSharePayload(payload));

  assert.deepEqual(decoded, payload);
});

test('collection with empty places array round-trips', () => {
  const payload: SharePayload = [
    {
      id: 'collection-empty',
      name: 'No Places Yet',
      places: [],
    },
  ];

  const decoded = decodeSharePayload(encodeSharePayload(payload));

  assert.deepEqual(decoded, payload);
});

test('decodeSharePayload throws a descriptive error for malformed base64', () => {
  assert.throws(() => decodeSharePayload('%%%not-base64%%%'), /valid base64/);
});

test('decodeSharePayload throws a descriptive error for valid base64 but invalid JSON', () => {
  const encodedNonJson = btoa(encodeURIComponent('not-json-content'));

  assert.throws(() => decodeSharePayload(encodedNonJson), /valid JSON/);
});

test('isValidSharePayload rejects wrong JSON shapes used defensively by decodeSharePayload', () => {
  const notArrayValue: unknown = { id: 'not-array' };
  const missingRequiredFields: unknown = [{ id: 'collection-only', places: [] }];

  assert.equal(isValidSharePayload(notArrayValue), false);
  assert.equal(isValidSharePayload(missingRequiredFields), false);

  const encodedWrongShape = btoa(encodeURIComponent(JSON.stringify(notArrayValue)));

  assert.throws(() => decodeSharePayload(encodedWrongShape), /share payload schema/);
});

test('isValidSharePayload accepts null for optional fields', () => {
  const payloadWithNulls = [
    {
      id: 'col-nulls',
      name: 'Null Checks',
      places: [
        {
          id: 'place-nulls',
          name: 'Null Place',
          type: null,
          image: null,
          address: null,
          rating: null,
          reviewCount: null,
        },
      ],
    },
  ];

  // We have to cast to unknown because TypeScript types say optional fields are undefined, not null.
  // But at runtime (JSON), they can be null.
  assert.equal(isValidSharePayload(payloadWithNulls), true);
});

test('unicode place names survive encode/decode', () => {
  const payload: SharePayload = [
    {
      id: 'unicode-collection',
      name: 'International Picks',
      places: [
        {
          id: 'unicode-place-1',
          name: '\u6771\u4EAC\u30BF\u30EF\u30FC \uD83D\uDDFC',
          type: '\u540D\u6240',
          address: '\u65E5\u672C \u6771\u4EAC\u90FD\u6E2F\u533A 4-2-8',
          rating: 4.9,
          reviewCount: 2084,
        },
        {
          id: 'unicode-place-2',
          name: 'Cafe na\u00EFve \u2615',
        },
      ],
    },
  ];

  const decoded = decodeSharePayload(encodeSharePayload(payload));

  assert.deepEqual(decoded, payload);
});
