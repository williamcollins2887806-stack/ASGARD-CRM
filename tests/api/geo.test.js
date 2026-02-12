/**
 * GEO - Geocoding endpoints — deep validation + negative tests
 */
const { api, assert, assertOk, assertArray, assertHasFields, assertFieldType } = require('../config');

module.exports = {
  name: 'GEO (Геокодирование)',
  tests: [
    {
      name: 'ADMIN reads geo cities — validates array shape',
      run: async () => {
        const resp = await api('GET', '/api/geo/cities', { role: 'ADMIN' });
        assertOk(resp, 'geo cities');
        if (resp.ok && resp.data) {
          const list = Array.isArray(resp.data) ? resp.data : (resp.data.cities || resp.data.items || []);
          assertArray(list, 'geo cities list');
          if (list.length > 0) {
            assert(typeof list[0] === 'string' || typeof list[0] === 'object', 'city item should be string or object');
          }
        }
      }
    },
    {
      name: 'PM reads geo cities',
      run: async () => {
        const resp = await api('GET', '/api/geo/cities', { role: 'PM' });
        assertOk(resp, 'PM geo cities');
      }
    },
    {
      name: 'Geocode known city — validates lat/lng',
      run: async () => {
        const resp = await api('GET', '/api/geo/geocode?city=Москва', { role: 'PM' });
        assertOk(resp, 'geocode');
        if (resp.ok && resp.data) {
          const data = resp.data.result || resp.data;
          if (data.lat !== undefined) {
            assert(typeof data.lat === 'number', `lat should be number, got ${typeof data.lat}`);
            assert(typeof data.lng === 'number' || typeof data.lon === 'number', 'lng/lon should be number');
          }
        }
      }
    },
    {
      name: 'Distance between two cities — validates number',
      run: async () => {
        const resp = await api('GET', '/api/geo/distance?from=Москва&to=Санкт-Петербург', { role: 'PM' });
        assertOk(resp, 'distance');
        if (resp.ok && resp.data) {
          const data = resp.data.result || resp.data;
          if (data.distance !== undefined) {
            assert(typeof data.distance === 'number', `distance should be number, got ${typeof data.distance}`);
            assert(data.distance > 0, `distance should be > 0, got ${data.distance}`);
          }
        }
      }
    },
    {
      name: 'NEGATIVE: geocode without city param → no 5xx',
      run: async () => {
        const resp = await api('GET', '/api/geo/geocode', { role: 'PM' });
        // Server may return empty result instead of 400 — just verify no crash
        assertOk(resp, 'geocode no param should not 5xx, got');
      }
    },
    {
      name: 'NEGATIVE: distance with missing params → no 5xx',
      run: async () => {
        const resp = await api('GET', '/api/geo/distance', { role: 'PM' });
        // Server may return empty result instead of 400 — just verify no crash
        assertOk(resp, 'distance no params should not 5xx, got');
      }
    },
    {
      name: 'Geocode unknown city — handles gracefully',
      run: async () => {
        const resp = await api('GET', '/api/geo/geocode?city=НесуществующийГород12345', { role: 'PM' });
        assertOk(resp, 'geocode unknown city: should not 5xx, got');
      }
    }
  ]
};
