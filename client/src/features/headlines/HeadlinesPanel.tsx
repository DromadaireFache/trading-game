import { Panel, Placeholder } from '../../components/Panel.tsx';

/** PLACEHOLDER (headlines milestone): Breaking news goes here. */
export function HeadlinesPanel({ className }: { className?: string }) {
  return (
    <Panel title="Headlines" aside="live feed" className={className}>
      <Placeholder>Breaking news goes here.</Placeholder>
    </Panel>
  );
}
