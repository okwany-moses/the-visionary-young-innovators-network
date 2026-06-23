const ts = require('typescript');
const fs = require('fs');
const path = 'src/components/RegistrationForm.tsx';
const src = fs.readFileSync(path, 'utf8');
const sf = ts.createSourceFile(path, src, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);
const diags = ts.getSyntacticDiagnostics(sf);
if (!diags.length) {
  console.log('no syntactic diagnostics');
} else {
  for (const d of diags) {
    console.log(ts.flattenDiagnosticMessageText(d.messageText, '\n'), 'at', d.start, 'length', d.length);
  }
}
