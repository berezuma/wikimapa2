// tools/missing-dedupe.mjs: euskaraz "falta" diren lekuen artean bikoiztuak kentzea
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupMatcher, removeDuplicates } from '../../tools/missing-dedupe.mjs';

const html = `
    <p data-group="kultura">Kultura</p><label><input data-category="Q16970"></label><label><input data-category="Q12518"></label>
    <p data-group="herriak">Herriak</p><label><input data-category="Q486972"></label>
</div></div>`;
const groupOf = groupMatcher(html, { Q16970: [16970], Q12518: [12518], Q486972: [486972, 2074737] });

// [qid, izena, lat, lon, hizkuntzak, iturria, iturri-izenburua, motak]
const missing = (qid, name, lat, lon, types, sourceTitle = name) => [qid, name, lat, lon, 1, 'es', sourceTitle, types];

test('groupMatcher: index.html-eko taldeak', () => {
    assert.equal(groupOf([2074737]), 'herriak');
    assert.equal(groupOf([16970]), 'kultura');
    assert.equal(groupOf([999]), 'besteak');
});

test('bot-bikoiztua (Leioa (lungsod)) kentzen da', () => {
    const articles = [['Leioa', 43.3289, -2.9847, [2074737]]];
    const result = removeDuplicates([missing('Q1', 'Leioa (lungsod)', 43.3269, -2.9888, [486972])], articles, groupOf);
    assert.equal(result.length, 0);
});

test('izen bera hizkuntza desberdinetan (iglesia/eliza, azentuak) kentzen da', () => {
    const articles = [['Santa Fe eliza (Zaldibia)', 43.035, -2.145, [16970]]];
    const result = removeDuplicates([missing('Q2', 'Iglesia de Santa Fé (Zaldivia)', 43.035, -2.145, [16970])], articles, groupOf);
    assert.equal(result.length, 0);
});

test('izen orokorra kenduta berdina baina mota desberdina (Torre de Letona ≠ Letona herria) mantentzen da', () => {
    const articles = [['Letona', 42.95, -2.75, [486972]]];
    const result = removeDuplicates([missing('Q3', 'Torre de Letona', 42.95, -2.75, [12518])], articles, groupOf);
    assert.equal(result.length, 1);
});

test('izen bereko eliza urrunago (0,6 km baino gehiago) mantentzen da', () => {
    const articles = [['San Pedro eliza (Eskoriatza)', 43.00, -2.50, [16970]]];
    const result = removeDuplicates([missing('Q4', 'Iglesia de San Pedro (Uncella)', 43.02, -2.50, [16970])], articles, groupOf);
    assert.equal(result.length, 1);
});

test('inguruan artikulurik ez badago mantentzen da', () => {
    const articles = [['Leioa', 43.3289, -2.9847, [2074737]]];
    const result = removeDuplicates([missing('Q5', 'Iglesia de San Juan Bautista (Lejona)', 43.3282, -2.9862, [16970])], articles, groupOf);
    assert.equal(result.length, 1);
});
