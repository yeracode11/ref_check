const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeLocationInput,
  locationFromLatLngFields,
} = require('../lib/checkinService');
const { publicUploadUrl } = require('../lib/uploadStorage');

describe('checkinService location', () => {
  it('normalizeLocationInput accepts lat/lng object', () => {
    const loc = normalizeLocationInput({ lat: 42.9, lng: 71.4 });
    assert.deepEqual(loc, { type: 'Point', coordinates: [71.4, 42.9] });
  });

  it('locationFromLatLngFields reads form fields', () => {
    const loc = locationFromLatLngFields({ lat: '42.9', lng: '71.4' });
    assert.deepEqual(loc, { type: 'Point', coordinates: [71.4, 42.9] });
  });
});

describe('uploadStorage', () => {
  it('publicUploadUrl builds absolute url when base set', () => {
    const prev = process.env.PUBLIC_BASE_URL;
    process.env.PUBLIC_BASE_URL = 'https://stellref.kz';
    assert.equal(
      publicUploadUrl('checkins/2026/07/abc.jpg'),
      'https://stellref.kz/uploads/checkins/2026/07/abc.jpg',
    );
    process.env.PUBLIC_BASE_URL = prev;
  });
});
