type Props = { class?: string; text?: string; testid?: string; attrs?: Record<string, string>; on?: Record<string, (e: Event) => void> };

/** Creates an element. Text is always set as text, never as HTML. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, children: (Node | null)[] = []): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.testid) node.dataset.testid = props.testid;
  for (const [k, v] of Object.entries(props.attrs ?? {})) node.setAttribute(k, v);
  for (const [k, f] of Object.entries(props.on ?? {})) node.addEventListener(k, f);
  for (const c of children) if (c) node.append(c);
  return node;
}
