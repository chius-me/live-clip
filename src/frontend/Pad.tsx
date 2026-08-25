import Editor, { type OnMount } from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Awareness } from "y-protocols/awareness";
import { MonacoBinding } from "y-monaco";
import * as Y from "yjs";
import { LANGUAGES, isLanguageId, type LanguageId } from "../shared/languages";
import {
  DEFAULT_LANGUAGE,
  Y_LANGUAGE_KEY,
  Y_META_KEY,
  Y_TEXT_KEY,
  type ConnectionRole,
} from "../shared/protocol";
import { copyText, downloadText } from "./clipboard";
import { installRemoteCursorStyles } from "./cursors";
import { getOrCreateIdentity } from "./identity";
import { monacoThemeName, registerClipThemes } from "./monaco-theme";
import { LiveClipProvider, type ConnectionStatus } from "./provider";
import { resolveEditSecret } from "./secret";

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connecting: "正在连接",
  connected: "已连接",
  reconnecting: "正在重连",
  saved: "已保存",
};

type Theme = "light" | "dark";

function readTheme(): Theme {
  try {
    const stored = localStorage.getItem("liveclip.theme");
    if (stored === "dark" || stored === "light") {
      return stored;
    }
  } catch {
    // ignore
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function wsUrl(roomId: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/rooms/${roomId}/ws`;
}

function extensionFor(language: string): string {
  const map: Record<string, string> = {
    markdown: "md",
    javascript: "js",
    typescript: "ts",
    plaintext: "txt",
    python: "py",
    shell: "sh",
  };
  return map[language] ?? language;
}

export function Pad({ roomId }: { roomId: string }) {
  const identity = useMemo(() => getOrCreateIdentity(), []);
  const doc = useMemo(() => new Y.Doc(), []);
  const ytext = useMemo(() => doc.getText(Y_TEXT_KEY), [doc]);
  const ymeta = useMemo(() => doc.getMap(Y_META_KEY), [doc]);

  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [role, setRole] = useState<ConnectionRole>("reader");
  const [online, setOnline] = useState(1);
  const [language, setLanguage] = useState<LanguageId>(DEFAULT_LANGUAGE);
  const [theme, setTheme] = useState<Theme>(() => readTheme());
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof import("monaco-editor") | null>(null);
  const awarenessRef = useRef<Awareness | null>(null);
  const bindingRef = useRef<MonacoBinding | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2200);
  }, []);

  const bindEditor = useCallback(() => {
    const editor = editorRef.current;
    const awareness = awarenessRef.current;
    const model = editor?.getModel();
    if (!editor || !awareness || !model) {
      return;
    }
    bindingRef.current?.destroy();
    bindingRef.current = new MonacoBinding(ytext, model, new Set([editor]), awareness);
  }, [ytext]);

  useEffect(() => {
    window.__LIVECLIP_TEXT = () => ytext.toString();
    window.__LIVECLIP_INSERT = (index, value) => {
      const at = Math.max(0, Math.min(index, ytext.length));
      ytext.insert(at, value);
    };
    return () => {
      delete window.__LIVECLIP_TEXT;
      delete window.__LIVECLIP_INSERT;
    };
  }, [ytext]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("liveclip.theme", theme);
    } catch {
      // ignore
    }
  }, [theme]);

  useEffect(() => {
    const secret = resolveEditSecret(roomId);
    const awareness = new Awareness(doc);
    awareness.setLocalStateField("user", identity);
    awarenessRef.current = awareness;
    const provider = new LiveClipProvider({
      url: wsUrl(roomId),
      doc,
      awareness,
      editSecret: secret,
      onStatus: setStatus,
      onRole: setRole,
      onOnline: setOnline,
      onToast: showToast,
    });
    const stopCursors = installRemoteCursorStyles(awareness, doc.clientID);
    bindEditor();
    const onMeta = () => {
      const next = ymeta.get(Y_LANGUAGE_KEY);
      if (typeof next === "string" && isLanguageId(next)) {
        setLanguage(next);
        const model = editorRef.current?.getModel();
        const monaco = monacoRef.current;
        if (model && monaco) {
          monaco.editor.setModelLanguage(model, next);
        }
      }
    };
    ymeta.observe(onMeta);
    onMeta();
    return () => {
      ymeta.unobserve(onMeta);
      stopCursors();
      bindingRef.current?.destroy();
      bindingRef.current = null;
      provider.destroy();
      awareness.destroy();
      awarenessRef.current = null;
    };
  }, [bindEditor, doc, identity, roomId, showToast, ymeta]);

  useEffect(() => {
    editorRef.current?.updateOptions({
      readOnly: role !== "editor",
      domReadOnly: role !== "editor",
    });
  }, [role]);

  const onMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    registerClipThemes(monaco);
    monaco.editor.setTheme(monacoThemeName(theme));
    const model = editor.getModel();
    if (model) {
      monaco.editor.setModelLanguage(model, language);
    }
    editor.updateOptions({ readOnly: role !== "editor", domReadOnly: role !== "editor" });
    bindEditor();
  };

  useEffect(() => {
    monacoRef.current?.editor.setTheme(monacoThemeName(theme));
  }, [theme]);

  const canEdit = role === "editor";

  const handleLanguage = (value: string) => {
    if (!canEdit || !isLanguageId(value)) {
      return;
    }
    ymeta.set(Y_LANGUAGE_KEY, value);
    setLanguage(value);
    const model = editorRef.current?.getModel();
    const monaco = monacoRef.current;
    if (model && monaco) {
      monaco.editor.setModelLanguage(model, value);
    }
  };

  const handleCopyAll = async () => {
    const ok = await copyText(ytext.toString());
    showToast(ok ? "已复制全文" : "复制失败，请手动选择文本");
  };

  const handleDownload = () => {
    downloadText(`liveclip-${roomId}.${extensionFor(language)}`, ytext.toString());
  };

  const handleClear = () => {
    if (!canEdit) {
      return;
    }
    if (!window.confirm("确定清空文档？此操作会同步到所有协作者。")) {
      return;
    }
    ytext.delete(0, ytext.length);
  };

  const handleShare = async (kind: "edit" | "read") => {
    const readUrl = `${window.location.origin}/p/${roomId}`;
    const secret = resolveEditSecret(roomId);
    const target = kind === "edit" && secret ? `${readUrl}#${secret}` : readUrl;
    if (kind === "edit" && !secret) {
      showToast("当前没有编辑密钥，只能分享只读链接");
      return;
    }
    const ok = await copyText(target);
    showToast(ok ? (kind === "edit" ? "已复制编辑链接" : "已复制只读链接") : "复制失败");
  };

  return (
    <div className="app">
      <header className={`toolbar${menuOpen ? " open" : ""}`}>
        <div className="brand">
          <a className="logo" href="/" title="新建文档">
            LIVECLIP
          </a>
          <span className={`status status-${status}`} data-testid="status">
            {STATUS_LABEL[status]}
          </span>
          <span className="online" data-testid="online-count">
            在线 {online}
          </span>
          {role === "reader" ? (
            <span className="badge" data-testid="role">
              只读
            </span>
          ) : (
            <span className="badge editor" data-testid="role">
              可编辑
            </span>
          )}
        </div>
        <button
          type="button"
          className="menu-toggle"
          aria-label="展开工具栏"
          onClick={() => setMenuOpen((open) => !open)}
        >
          菜单
        </button>
        <div className="actions">
          <label className="field">
            语言
            <select
              data-testid="language"
              value={language}
              disabled={!canEdit}
              onChange={(event) => handleLanguage(event.target.value)}
            >
              {LANGUAGES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => void handleCopyAll()}>
            复制全文
          </button>
          <button type="button" onClick={handleDownload}>
            下载文本
          </button>
          <button type="button" disabled={!canEdit} onClick={handleClear}>
            清空文档
          </button>
          <button
            type="button"
            data-testid="copy-readonly"
            onClick={() => void handleShare("read")}
          >
            复制只读链接
          </button>
          <button type="button" data-testid="copy-edit" onClick={() => void handleShare("edit")}>
            复制编辑链接
          </button>
          <button
            type="button"
            onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
          >
            {theme === "dark" ? "浅色主题" : "深色主题"}
          </button>
          <a className="button-link" href="/" data-testid="new-doc">
            新建文档
          </a>
        </div>
      </header>
      <div className="editor-wrap" data-testid="editor">
        <Editor
          theme={monacoThemeName(theme)}
          defaultLanguage={DEFAULT_LANGUAGE}
          defaultValue=""
          onMount={onMount}
          options={{
            readOnly: !canEdit,
            domReadOnly: !canEdit,
            minimap: { enabled: false },
            fontSize: 14,
            wordWrap: "on",
            automaticLayout: true,
            scrollBeyondLastLine: false,
            padding: { top: 8 },
            renderLineHighlight: "all",
            tabSize: 2,
            unicodeHighlight: { ambiguousCharacters: false },
          }}
        />
      </div>
      {toast ? (
        <div className="toast" role="status">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
