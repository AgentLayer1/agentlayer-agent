import type { Ask } from '../ask';
import { SCHEMA, type HomeEntry } from '../data';
import { label, note, row, symbol } from '../style';

const PROMPTS = [
  { title: 'Brief me', symbolName: 'sun.max', prompt: 'Brief me' },
  { title: 'Plan my day', symbolName: 'calendar', prompt: 'Plan my day' },
  { title: 'What’s stale?', symbolName: 'clock.arrow.circlepath', prompt: 'What has gone stale?' },
  { title: 'Check support', symbolName: 'lifepreserver', prompt: 'Check the support queue' },
  { title: 'Capture a note', symbolName: 'square.and.pencil', prompt: 'Capture this note: ' },
  { title: 'Wrap up the day', symbolName: 'moon', prompt: 'Wrap up the day' }
];

const button = (title: string, enabled: () => boolean, onTap: () => void) =>
  Text(title)
    .font(12)
    .weight('medium')
    .paddingHorizontal(10)
    .paddingVertical(5)
    .background('#7f7f7f24')
    .hoverBackground('#7f7f7f3d')
    .cornerRadius(6)
    .opacity(() => (enabled() ? 1 : 0.4))
    .cursor('pointer')
    .onTap(onTap);

const body = (path: string, entry: HomeEntry, ask: Ask) => {
  const [text, setText] = signal('');
  const hasText = () => text().trim() !== '';
  return VStack({ spacing: 2 }, [
    note(`Each opens a new chat with ${entry.name} and types the request in. Press Enter there to send it.`),
    label('ASK'),
    ...PROMPTS.map((item) =>
      row(symbol(item.symbolName), item.title, 'plus.bubble', () => ask.newChat(path, entry, item.prompt))
    ),
    label('YOUR OWN'),
    HStack([
      TextField('', { placeholder: `Ask ${entry.name}…`, autofocus: false, onEdit: (typed) => setText(typed ?? '') })
    ])
      .paddingHorizontal(9)
      .paddingVertical(6)
      .background('#7f7f7f24')
      .cornerRadius(8)
      .paddingHorizontal(4),
    HStack({ spacing: 6 }, [
      button('New chat', hasText, () => hasText() && ask.newChat(path, entry, text())),
      button(
        'Draft here',
        () => hasText() && ask.canDraft(),
        () => ask.draftHere(text())
      ),
      Spacer()
    ])
      .paddingHorizontal(4)
      .paddingTop(4),
    Text(ask.status).font(11).color('secondary').paddingHorizontal(10).paddingTop(4)
  ]);
};

/**
 * Plain-word requests for the scoped agent, typed into a chat and never sent: the person presses Enter.
 */
export const askPage = (ask: Ask, home: () => string | undefined) =>
  VStack({ spacing: 0 }, [
    ForEach(
      {
        items: () => {
          const path = home();
          const entry = path ? DATA.homes[path] : undefined;
          return path && entry?.schema === SCHEMA ? [{ path, entry }] : [];
        },
        key: (item) => item.path
      },
      (item) => body(item().path, item().entry, ask)
    ),
    ForEach({ items: () => (home() ? [] : ['empty']), key: (item) => item }, () =>
      note('No agent has joined this sidebar yet.')
    )
  ]);
