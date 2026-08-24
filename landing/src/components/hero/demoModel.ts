export type Mode = 'design' | 'nodes'
export type LayerId = 'login' | 'email' | 'password' | 'submit'
export type NodeId = 'ui' | 'fn' | 'api'

export const LAYERS: { id: LayerId; name: string; kind: string }[] = [
  { id: 'login', name: 'Login', kind: 'Frame' },
  { id: 'email', name: 'Email', kind: 'Input' },
  { id: 'password', name: 'Password', kind: 'Input' },
  { id: 'submit', name: 'Submit', kind: 'Button' },
]

export const NODES: { id: NodeId; name: string; kind: string; hue: string; fill: string }[] = [
  {
    id: 'ui',
    name: 'LoginScreen',
    kind: 'UI',
    hue: 'var(--color-node-ui)',
    fill: 'var(--color-node-ui-fill)',
  },
  {
    id: 'fn',
    name: 'validate',
    kind: 'FN',
    hue: 'var(--color-node-fn)',
    fill: 'var(--color-node-fn-fill)',
  },
  {
    id: 'api',
    name: 'POST /auth/login',
    kind: 'API',
    hue: 'var(--color-node-api)',
    fill: 'var(--color-node-api-fill)',
  },
]

export const NODE_PORTS: Record<NodeId, [string, string][]> = {
  ui: [
    ['emit', 'onSubmit'],
    ['email', 'string'],
  ],
  fn: [
    ['in', 'Credentials'],
    ['out', 'boolean'],
  ],
  api: [
    ['body', 'Credentials'],
    ['200', '{ token }'],
  ],
}

export type DemoState = {
  radius: Record<LayerId, number>
  label: string
}

export const INITIAL: DemoState = {
  radius: { login: 10, email: 5, password: 5, submit: 5 },
  label: 'Sign in',
}

/** Static inspector rows per layer. The editable props are rendered separately. */
export const LAYER_PROPS: Record<LayerId, [string, string][]> = {
  login: [['gap', '8']],
  email: [['bind', 'form.email']],
  password: [['bind', 'form.password']],
  submit: [['emit', 'onSubmit']],
}

export type CodeLine = { no: number; text: string; traces?: (LayerId | NodeId)[] }

/**
 * The emitted file, derived from demo state. Editing radius or the button label
 * in the inspector changes these lines, which is the whole point: the canvas is
 * the source and the code is the output.
 */
export function emit(state: DemoState): CodeLine[] {
  return [
    { no: 1, text: 'export function LoginScreen() {', traces: ['ui'] },
    { no: 2, text: '  const { mutate } = useLogin()', traces: ['fn', 'api'] },
    { no: 3, text: '  return (' },
    { no: 4, text: `    <Frame gap={8} radius={${state.radius.login}}>`, traces: ['login'] },
    { no: 5, text: `      <Field name="email" radius={${state.radius.email}} />`, traces: ['email'] },
    {
      no: 6,
      text: `      <Field name="password" radius={${state.radius.password}} />`,
      traces: ['password'],
    },
    {
      no: 7,
      text: `      <Button onClick={mutate} radius={${state.radius.submit}}>${state.label || 'Sign in'}</Button>`,
      traces: ['submit'],
    },
    { no: 8, text: '    </Frame>' },
    { no: 9, text: '  )' },
    { no: 10, text: '}' },
  ]
}
