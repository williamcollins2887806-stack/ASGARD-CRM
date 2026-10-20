'use strict';
/**
 * Preload-хук мутационного контроля D-295.
 * Подменяет `src/routes/field-manage.js` на мутант, не трогая рабочее дерево:
 *   NODE_OPTIONS="--require ./tools/d295_mutant_hook.js"
 * Хук активен только если существует файл-мутант.
 */
const Module = require('module');
const fs = require('fs');
const path = require('path');

const real = path.join(__dirname, '..', 'src', 'routes', 'field-manage.js');
const mutant = path.join(__dirname, '..', 'src', 'routes', 'field-manage.mutant.js');

if (fs.existsSync(mutant)) {
  const origResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, ...rest) {
    const resolved = origResolve.call(this, request, parent, ...rest);
    if (path.resolve(resolved) === path.resolve(real)) return mutant;
    return resolved;
  };
  console.log('[d295-mutant] ACTIVE →', mutant);
}
