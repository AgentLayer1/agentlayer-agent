import type { HostSection, SectionCard } from 'cmux-custom-manager/sections';
import { SCHEMA, type HeartbeatPlace, type HomeEntry, type NoteItem } from './data';
import { choiceButton, heartbeatRoute } from './proposals';
import { placeSession } from './session';
import { GREEN, PURPLE, when } from './style';

interface Shown {
  key: string;
  entry: HomeEntry;
  item: NoteItem;
}

const hhmm = (iso: string): string => iso.slice(11, 16);

const body = ({ entry, item }: Shown, send: (text: string, place: HeartbeatPlace) => void) => {
  const place = () => heartbeatRoute(entry.heartbeat);
  const act = (text: string) => {
    const target = place();
    if (target) {
      send(text, target);
    }
  };
  // Start names the workspace the session belongs in, picked here where cmux's workspaces are known.
  const start = () => {
    const target = placeSession(entry, { words: `${item.title} ${item.next}` });
    return `/note start ${item.id}${target.kind === 'workspace' ? ` --workspace=${target.id}` : ''}`;
  };
  return VStack({ spacing: 5, alignment: 'leading' }, [
    Text(item.body).font(11).color('secondary'),
    Text(`Next: ${item.next}`).font(11),
    ...item.sources.map((url) => Text(url).font(10).color('tertiary').lineLimit(1).truncation('middle')),
    when(
      () => place() !== null,
      () =>
        HStack({ spacing: 4 }, [
          ...(item.canStart ? [choiceButton('Start', () => act(start()), entry.colors?.primary ?? PURPLE)] : []),
          ...(item.reaction ? [] : [choiceButton('Useful', () => act(`/note useful ${item.id}`))]),
          choiceButton('Dismiss', () => act(`/note dismiss ${item.id}`)),
          Spacer({ minLength: 0 })
        ]).paddingTop(3)
    ),
    when(
      () => place() === null,
      () => Text(`Run /heartbeat in one of ${entry.name}’s sessions to act on these here.`).font(10).color('tertiary').paddingTop(3)
    )
  ]);
};

/**
 * The Manager's NOTES section: every joined agent's notes from today and yesterday, unread first. It opens while one
 * is unread. A button types `/note <choice> <id>` into that agent's heartbeat; a dismissed note leaves when the
 * sidebar is redrawn.
 */
export const notesSection = (): HostSection => {
  const homes = Object.entries(DATA.homes).filter(([, entry]) => entry.schema === SCHEMA);
  const shown = homes.flatMap(([home, entry]) =>
    (entry.notes ?? []).map((item): Shown => ({ key: `${home}#${item.id}`, entry, item }))
  );
  const card = (note: Shown): SectionCard => {
    const { entry, item, key } = note;
    return {
      key,
      title: item.title,
      span: hhmm(item.at),
      badges: [
        { text: `${entry.emoji} ${entry.name}`, color: entry.colors?.primary ?? PURPLE },
        ...(item.reaction === 'useful' ? [{ text: 'useful', color: GREEN, icon: 'checkmark' }] : [])
      ],
      summary: item.next,
      searchText: `${item.body} ${item.next}`,
      body: () =>
        body(note, (text, place) =>
          cmux('surface.send_text', { surface_id: place.surfaceId, workspace_id: place.workspaceId, text: `${text}\n` })
        )
    };
  };
  return {
    label: 'NOTES',
    icon: 'note.text',
    color: PURPLE,
    folded: !shown.some(({ item }) => item.reaction === ''),
    expandFirst: false,
    cards: computed(() => shown.map(card))
  };
};
