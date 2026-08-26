import type { editor as MonacoEditor } from "monaco-editor";
import type { MonacoBinding } from "y-monaco";
import type * as Y from "yjs";

export function monacoMatchesYtext(model: MonacoEditor.ITextModel, ytext: Y.Text): boolean {
  return model.getValue() === ytext.toString();
}

export function alignMonacoToYtext(
  editor: MonacoEditor.IStandaloneCodeEditor,
  ytext: Y.Text,
  binding: MonacoBinding,
  eol: MonacoEditor.EndOfLineSequence,
): void {
  const model = editor.getModel();
  if (!model || model.isDisposed()) {
    return;
  }
  const expected = ytext.toString();
  if (model.getValue() === expected) {
    return;
  }
  binding.mux(() => {
    if (model.getValue() === expected) {
      return;
    }
    const pos = editor.getPosition();
    const offset = pos ? model.getOffsetAt(pos) : expected.length;
    model.setValue(expected);
    model.setEOL(eol);
    const next = Math.max(0, Math.min(offset, expected.length));
    editor.setPosition(model.getPositionAt(next));
  });
}

export function installEditorSyncGuard(options: {
  editor: MonacoEditor.IStandaloneCodeEditor;
  ytext: Y.Text;
  binding: MonacoBinding;
  eol: MonacoEditor.EndOfLineSequence;
}): () => void {
  const { editor, ytext, binding, eol } = options;
  let composing = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const align = () => {
    if (composing > 0) {
      return;
    }
    alignMonacoToYtext(editor, ytext, binding, eol);
  };

  const schedule = () => {
    if (timer != null) {
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      align();
    }, 0);
  };

  ytext.observe(schedule);
  const model = editor.getModel();
  const content = model?.onDidChangeContent(() => schedule());
  const start = editor.onDidCompositionStart(() => {
    composing += 1;
  });
  const end = editor.onDidCompositionEnd(() => {
    composing = Math.max(0, composing - 1);
    schedule();
  });
  schedule();

  return () => {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
    ytext.unobserve(schedule);
    content?.dispose();
    start.dispose();
    end.dispose();
  };
}
