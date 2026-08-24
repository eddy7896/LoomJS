import type { ComponentEmitter } from '../types';
import { indent } from '../emit/text';
import { staticString, valueExpr } from '../emit/props';
import { styleAttr } from '../emit/style';
import { layoutSizeStyle } from '../emit/layout';
import { classAttr } from '../emit/variants';
import { eventAttr } from '../emit/actions';
import { usesAuth } from '../emit/auth';

/**
 * Calendar and chat (`docs/31-calendar-chat.md`).
 *
 * Both are the same idea: **rows, in a shape**. A calendar is rows falling on the days they belong
 * to; a chat is rows in a column with a box underneath. Neither invents a storage system — they
 * work over whatever connector the project already has, which is why "chat" did not need a chat
 * server to exist.
 */

const rowsOf = (
  component: Parameters<ComponentEmitter['emit']>[0],
  ctx: Parameters<ComponentEmitter['emit']>[1],
): string => {
  const items = component.props.items;
  return items ? valueExpr(items, ctx, component.id, 'items') : '[]';
};

const staticNumber = (
  component: Parameters<ComponentEmitter['emit']>[0],
  key: string,
  fallback: number,
): number => {
  const value = component.props[key];
  if (value?.kind !== 'static') return fallback;
  const parsed = Number(value.value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const calendarEmitter: ComponentEmitter = {
  type: 'Calendar',
  emit(component, ctx, depth) {
    const ident = component.id.replace(/[^a-zA-Z0-9_]/g, '_');
    const agenda = component.props.variant?.kind === 'static' && component.props.variant.value === 'agenda';
    const monday = staticString(component, 'weekStart', 'monday') !== 'sunday';

    const dateKey = staticString(component, 'dates');
    const titleKey = staticString(component, 'titles');
    const empty = staticString(component, 'empty', 'Nothing yet');

    const byDay = `days_${ident}`;

    ctx.requireCalendar(['eventsByDay']);

    if (agenda) {
      ctx.requireCalendar(['upcoming', 'timeOf']);

      return `${indent(depth)}<div${classAttr(component)}${styleAttr(component, ctx, layoutSizeStyle(component.layout))}>
${indent(depth + 1)}{(() => {
${indent(depth + 2)}const ${byDay} = eventsByDay((${rowsOf(component, ctx)}) as Record<string, unknown>[], ${JSON.stringify(dateKey)}, ${JSON.stringify(titleKey)});
${indent(depth + 2)}const list = upcoming(${byDay});
${indent(depth + 2)}if (list.length === 0) return <span className="loom-calendar__empty">{${JSON.stringify(empty)}}</span>;
${indent(depth + 2)}return (
${indent(depth + 3)}<ol className="loom-calendar__agenda">
${indent(depth + 4)}{list.map((event, index) => (
${indent(depth + 5)}<li key={index} className="loom-calendar__row">
${indent(depth + 6)}<span className="loom-calendar__when">{event.key}{timeOf(event.date) ? " " + timeOf(event.date) : ""}</span>
${indent(depth + 6)}<span className="loom-calendar__what">{event.title}</span>
${indent(depth + 5)}</li>
${indent(depth + 4)}))}
${indent(depth + 3)}</ol>
${indent(depth + 2)});
${indent(depth + 1)}})()}
${indent(depth)}</div>`;
    }

    /**
     * The month being looked at, as real state.
     *
     * An offset from this month rather than a stored date: it survives the app being open past
     * midnight on the 31st, and "back three months" is one number rather than three fields that
     * have to agree.
     */
    const offset = ctx.requireState(`month_${ident}`, 0);

    // The week this calendar starts on, and only that one: importing both would leave one unread,
    // and the emitted app builds with `noUnusedLocals`.
    const weekdays = monday ? 'WEEKDAYS_MONDAY' : 'WEEKDAYS_SUNDAY';
    ctx.requireCalendar(['monthGrid', 'monthName', weekdays]);

    return `${indent(depth)}<div${classAttr(component)}${styleAttr(component, ctx, layoutSizeStyle(component.layout))}>
${indent(depth + 1)}{(() => {
${indent(depth + 2)}const shown = new Date(new Date().getFullYear(), new Date().getMonth() + ${offset}, 1);
${indent(depth + 2)}const ${byDay} = eventsByDay((${rowsOf(component, ctx)}) as Record<string, unknown>[], ${JSON.stringify(dateKey)}, ${JSON.stringify(titleKey)});
${indent(depth + 2)}return (
${indent(depth + 3)}<>
${indent(depth + 4)}<div className="loom-calendar__head">
${indent(depth + 5)}<button type="button" className="loom-calendar__step" aria-label="Previous month" onClick={() => set_${offset}(${offset} - 1)}>
${indent(depth + 6)}{"\\u2039"}
${indent(depth + 5)}</button>
${indent(depth + 5)}<span className="loom-calendar__month">{monthName(shown.getFullYear(), shown.getMonth())}</span>
${indent(depth + 5)}<button type="button" className="loom-calendar__step" aria-label="Next month" onClick={() => set_${offset}(${offset} + 1)}>
${indent(depth + 6)}{"\\u203a"}
${indent(depth + 5)}</button>
${indent(depth + 4)}</div>
${indent(depth + 4)}<div className="loom-calendar__grid">
${indent(depth + 5)}{${weekdays}.map((name) => (
${indent(depth + 6)}<span key={name} className="loom-calendar__weekday">{name}</span>
${indent(depth + 5)}))}
${indent(depth + 5)}{monthGrid(shown.getFullYear(), shown.getMonth(), ${monday}).map((day) => (
${indent(depth + 6)}<div
${indent(depth + 7)}key={day.key}
${indent(depth + 7)}className={"loom-calendar__day" + (day.inMonth ? "" : " is-outside") + (day.today ? " is-today" : "")}
${indent(depth + 6)}>
${indent(depth + 7)}<span className="loom-calendar__date">{day.date.getDate()}</span>
${indent(depth + 7)}{(${byDay}.get(day.key) ?? []).map((event, index) => (
${indent(depth + 8)}<span key={index} className="loom-calendar__event">{event.title}</span>
${indent(depth + 7)}))}
${indent(depth + 6)}</div>
${indent(depth + 5)}))}
${indent(depth + 4)}</div>
${indent(depth + 3)}</>
${indent(depth + 2)});
${indent(depth + 1)}})()}
${indent(depth)}</div>`;
  },
};

/**
 * Chat: messages in a column, a box underneath.
 *
 * The messages are rows from a query, and sending is an ordinary action sequence — the same one a
 * Button runs. That is what makes this work over every connector loom has rather than needing a
 * chat server of its own.
 */
export const chatEmitter: ComponentEmitter = {
  type: 'Chat',
  emit(component, ctx, depth) {
    const ident = component.id.replace(/[^a-zA-Z0-9_]/g, '_');

    const textKey = staticString(component, 'texts');
    const authorKey = staticString(component, 'authors');
    const timeKey = staticString(component, 'times');
    const empty = staticString(component, 'empty', 'No messages yet');
    const placeholder = staticString(component, 'placeholder', 'Write a message');
    const send = staticString(component, 'sendLabel', 'Send');

    // The composer's text is an ordinary field state, so a "save row" step reads it exactly as it
    // reads any other input.
    const draft = ctx.requireFieldState(component.id, '');
    const rows = `messages_${ident}`;

    const handler = eventAttr(component, ctx, 'onSend', depth + 4);

    /**
     * New messages arrive by asking again on a timer (`docs/31-calendar-chat.md`).
     *
     * Not a websocket, and the element says so: the app's data goes through server routes so the
     * database credentials stay on the server, and a subscription from the browser needs a key in
     * the browser. That is a different security model, and it is worth doing deliberately rather
     * than smuggling in behind a chat element.
     */
    const seconds = staticNumber(component, 'refresh', 0);
    const items = component.props.items;
    if (seconds > 0 && items?.kind === 'bound') {
      const feed = ctx.plans.find((plan) => plan.node.id === items.source.nodeId);
      if (feed) {
        const ms = Math.max(1000, Math.round(seconds * 1000));
        ctx.requireEffect(`  useEffect(() => {
    const timer = setInterval(() => {
      void ${feed.names.run}();
    }, ${ms});
    return () => clearInterval(timer);
  }, [${feed.names.run}]);`);
      }
    }

    /**
     * Your own messages sit on the right.
     *
     * That needs to know who you are, which the project knows only when it signs people in. Without
     * sign-in every message is somebody else's — honest for a public feed, and better than asking
     * for a session that does not exist.
     */
    const signedIn = usesAuth(ctx.snapshot);
    const mine =
      authorKey && signedIn
        ? `(String(message[${JSON.stringify(authorKey)}] ?? "") === String(${ctx.requireAuth()}.user?.email ?? ""))`
        : 'false';

    const time = timeKey
      ? `\n${indent(depth + 7)}<span className="loom-chat__time">{String(message[${JSON.stringify(timeKey)}] ?? "")}</span>`
      : '';

    const author = authorKey
      ? `\n${indent(depth + 7)}<span className="loom-chat__who">{String(message[${JSON.stringify(authorKey)}] ?? "")}</span>`
      : '';

    return `${indent(depth)}<div${classAttr(component)}${styleAttr(component, ctx, layoutSizeStyle(component.layout))}>
${indent(depth + 1)}<div className="loom-chat__log" role="log" aria-live="polite">
${indent(depth + 2)}{(() => {
${indent(depth + 3)}const ${rows} = (${rowsOf(component, ctx)}) as Record<string, unknown>[];
${indent(depth + 3)}if (${rows}.length === 0) return <span className="loom-chat__empty">{${JSON.stringify(empty)}}</span>;
${indent(depth + 3)}return ${rows}.map((message, index) => (
${indent(depth + 4)}<div
${indent(depth + 5)}key={index}
${indent(depth + 5)}className={${mine} ? "loom-chat__message is-mine" : "loom-chat__message"}
${indent(depth + 4)}>${author}
${indent(depth + 5)}<span className="loom-chat__text">{String(message[${JSON.stringify(textKey)}] ?? "")}</span>${time}
${indent(depth + 4)}</div>
${indent(depth + 3)}));
${indent(depth + 2)}})()}
${indent(depth + 1)}</div>
${indent(depth + 1)}<div className="loom-chat__compose">
${indent(depth + 2)}<input
${indent(depth + 3)}className="loom-chat__draft"
${indent(depth + 3)}value={${draft}}
${indent(depth + 3)}placeholder={${JSON.stringify(placeholder)}}
${indent(depth + 3)}aria-label={${JSON.stringify(placeholder)}}
${indent(depth + 3)}onChange={(event) => set_${draft}(event.target.value)}
${indent(depth + 2)}/>
${indent(depth + 2)}<button type="button" className="loom-chat__send"${handler}>
${indent(depth + 3)}{${JSON.stringify(send)}}
${indent(depth + 2)}</button>
${indent(depth + 1)}</div>
${indent(depth)}</div>`;
  },
};
