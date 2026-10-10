// Datenmodell nach "Getting Things Done" (David Allen)

/** Die Listen aus dem Buch. "done" und "trash" sind Ablagen der App. */
export type ListName =
  | 'inbox'      // Eingang: noch nicht geklärt
  | 'next'       // Nächste Schritte
  | 'waiting'    // Warten auf (delegiert)
  | 'someday'    // Irgendwann/Vielleicht
  | 'reference'  // Referenzmaterial (nicht umsetzbar, aber nützlich)
  | 'done'
  | 'trash';

export interface Item {
  id: string;
  title: string;
  notes: string;
  list: ListName;
  /** Kontext wie "@Telefon". null = ohne Kontext */
  context: string | null;
  projectId: string | null;
  /** Bei "Warten auf": wer ist dran? */
  waitingFor: string | null;
  /** Wiedervorlage (Tickler) als YYYY-MM-DD: vorher unsichtbar bzw. "nachfassen ab" */
  tickler: string | null;
  /** Fälligkeitsdatum (Deadline) als YYYY-MM-DD. Fehlt bei älteren Einträgen. */
  due?: string | null;
  created: number;
  updated: number;
  completed: number | null;
  /** Liste vor "erledigt" oder "Papierkorb", für Wiederherstellen */
  prevList?: ListName | null;
  /** Endgültig gelöscht (Papierkorb geleert) */
  deleted?: boolean;
  /** Eigene Position innerhalb des Projekts (Ziehen in der Projektansicht). null = nach Frist. Ab 0.8. */
  order?: number | null;
}

export type ProjectStatus = 'active' | 'someday' | 'done' | 'dropped';

export interface Project {
  id: string;
  title: string;
  /** Gewünschtes Ergebnis: "Wie sieht es aus, wenn es fertig ist?" */
  outcome: string;
  status: ProjectStatus;
  /** Fälligkeitsdatum des ganzen Projekts als YYYY-MM-DD */
  due?: string | null;
  created: number;
  updated: number;
  completed: number | null;
  deleted?: boolean;
  /** 0.8–0.9: „Nur die nächste“. Seit 0.10 ohne Wirkung; bleibt nur erhalten (Felder werden nie entfernt). */
  sequential?: boolean;
}

/**
 * Jede Änderung wird als unveränderliches Ereignis gespeichert.
 * Der aktuelle Zustand entsteht durch Abspielen aller Ereignisse in Zeitreihenfolge.
 * Damit lassen sich Ereignisse mehrerer Geräte später einfach zusammenführen (Sync).
 */
export type EventType =
  | 'item.create'
  | 'item.patch'
  | 'project.create'
  | 'project.patch'
  | 'context.add'
  | 'context.remove';

export interface GtdEvent {
  id: string;
  ts: number;
  device: string;
  /** Bekannte Typen siehe EventType. Neuere Versionen können weitere Typen schreiben. */
  type: EventType | (string & {});
  data: any;
  /** Format-Version (fehlt bei Ereignissen aus Version 0.1–0.3 = Format 1) */
  v?: number;
}

export interface State {
  items: Map<string, Item>;
  projects: Map<string, Project>;
  contexts: string[];
}
