import {
  AlignCenter,
  Bold,
  ChevronsUpDown,
  IndentDecrease,
  IndentIncrease,
  Italic,
  List,
  ListOrdered,
  PanelLeft,
  Quote,
  Redo2,
  Strikethrough,
  Type,
  Underline,
  Undo2,
} from 'lucide-react';

// Drawn to match the Figma; formatting isn't part of this demo, the body is sent as plain text.
const GROUPS = [[Undo2, Redo2], [Type], [Bold, Italic, Underline], [AlignCenter, ChevronsUpDown], [ListOrdered, List, IndentIncrease, IndentDecrease, Quote, PanelLeft], [Strikethrough]];

export function EditorToolbar() {
  return (
    <div aria-hidden="true" title="Formatting isn't part of this demo" className="flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-ink/60">
      {GROUPS.map((group, g) => (
        <div key={g} className="flex items-center gap-1">
          {g > 0 && <span className="mx-1.5 h-4 w-px bg-line" />}
          {group.map((Icon, i) => (
            <span key={i} className="p-1">
              <Icon className="size-4" />
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
