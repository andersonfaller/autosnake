/*
 * Code editor: CodeMirror with SnakeScript highlighting and autocomplete when the
 * CDN is reachable, a plain textarea otherwise. Both expose the same small interface.
 */
(function (root) {
  'use strict';

  const docs = root.SnakeDocs;
  const entries = docs.sections.flatMap((section) => section.entries);
  const apiNames = entries.map((entry) => entry.name);
  const takesNoArgs = new Set(entries.filter((e) => e.sig.endsWith('()')).map((e) => e.name));
  const isFunction = new Set(entries.filter((e) => e.sig.includes('(')).map((e) => e.name));

  function createCodeEditor(textarea, onChange) {
    return root.CodeMirror ? codeMirrorEditor(textarea, onChange) : plainEditor(textarea, onChange);
  }

  // Paints SnakeScript's built-in words so the language reads as a language.
  const apiWord = new RegExp('^(?:' + apiNames.join('|') + ')(?![\\w$])');
  const apiOverlay = {
    token(stream) {
      const prev = stream.pos > 0 ? stream.string.charAt(stream.pos - 1) : '';
      if (!/[\w$.]/.test(prev) && stream.match(apiWord)) return 'api';
      if (stream.match(/^[\w$]+/)) return null;
      stream.next();
      return null;
    },
  };

  function hintItem(name, sig, short) {
    return {
      text: name,
      render(element) {
        element.innerHTML = '';
        const label = document.createElement('span');
        label.className = 'hint-name';
        label.textContent = sig;
        const note = document.createElement('span');
        note.className = 'hint-note';
        note.textContent = short;
        element.append(label, note);
      },
      hint(cm, data, completion) {
        const call = isFunction.has(name) && !data.owner;
        cm.replaceRange(call ? name + '()' : name, data.from, data.to, 'complete');
        if (call && !takesNoArgs.has(name)) cm.execCommand('goCharLeft');
      },
    };
  }

  const globalHints = entries.map((e) => hintItem(e.name, e.sig, e.short));
  const propHints = Object.fromEntries(
    Object.entries(docs.props).map(([owner, list]) => [owner, list.map((p) => hintItem(p.name, owner + '.' + p.name, p.short))])
  );

  function snakeHint(cm, options) {
    const cursor = cm.getCursor();
    const token = cm.getTokenAt(cursor);
    if (/comment|string/.test(token.type || '')) return null;
    const before = cm.getLine(cursor.line).slice(0, cursor.ch);
    const match = /(?:\b(me|enemy|food|board)\s*\.\s*)?([A-Za-z_$][\w$]*)?$/.exec(before);
    const owner = match[1];
    const word = match[2] || '';
    if (!owner && /\.\s*[\w$]*$/.test(before)) return null; // property of something else
    if (!owner && !word && options && options.auto) return null; // typed a digit or symbol
    const pool = owner ? propHints[owner] : globalHints;
    const list = pool.filter((item) => item.text.startsWith(word) && item.text !== word);
    if (!list.length) return null;
    return {
      list,
      owner,
      from: root.CodeMirror.Pos(cursor.line, cursor.ch - word.length),
      to: cursor,
    };
  }

  function codeMirrorEditor(textarea, onChange) {
    const cm = root.CodeMirror.fromTextArea(textarea, {
      mode: 'javascript',
      theme: 'snake',
      lineNumbers: true,
      indentUnit: 2,
      tabSize: 2,
      matchBrackets: true,
      autoCloseBrackets: true,
      extraKeys: {
        'Ctrl-Space': 'autocomplete',
        Tab: (editor) =>
          editor.somethingSelected() ? editor.indentSelection('add') : editor.replaceSelection('  ', 'end'),
        'Shift-Tab': (editor) => editor.indentSelection('subtract'),
      },
      hintOptions: { hint: snakeHint, completeSingle: false },
    });
    cm.addOverlay(apiOverlay);
    cm.on('changes', (_, changes) => {
      if (changes.some((change) => change.origin !== 'setValue')) onChange();
    });
    cm.on('inputRead', (_, change) => {
      if (cm.showHint && !cm.state.completionActive && /^[\w$.]$/.test(change.text[0])) {
        cm.showHint({ completeSingle: false, auto: true });
      }
    });

    let marked = null;
    return {
      kind: 'codemirror',
      getValue: () => cm.getValue(),
      setValue: (code) => cm.setValue(code),
      markLine(line) {
        const valid = Number.isInteger(line) && line >= 1 && line <= cm.lineCount() ? line : null;
        if (marked && marked.line === valid && cm.getLineNumber(marked.handle) === valid - 1) return;
        if (marked) cm.removeLineClass(marked.handle, 'background', 'cm-error-line');
        marked = valid ? { line: valid, handle: cm.addLineClass(valid - 1, 'background', 'cm-error-line') } : null;
      },
      refresh: () => cm.refresh(),
    };
  }

  function plainEditor(textarea, onChange) {
    textarea.classList.add('plain-editor');
    textarea.addEventListener('input', onChange);
    textarea.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab' || event.shiftKey) return;
      event.preventDefault();
      const { selectionStart: start, selectionEnd: end, value } = textarea;
      textarea.value = value.slice(0, start) + '  ' + value.slice(end);
      textarea.selectionStart = textarea.selectionEnd = start + 2;
      onChange();
    });
    return {
      kind: 'plain',
      getValue: () => textarea.value,
      setValue: (code) => {
        textarea.value = code;
      },
      markLine() {},
      refresh() {},
    };
  }

  root.createCodeEditor = createCodeEditor;
})(window);
