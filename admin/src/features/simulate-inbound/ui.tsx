import { type FormEvent, useState } from 'react';

import { Button, Input } from '@/shared/ui';

import { useSimulateInbound } from './use-simulate-inbound';

export function SimulateForm() {
  const [from, setFrom] = useState('+15555550123');
  const [body, setBody] = useState('');
  const mutation = useSimulateInbound();

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!from.trim() || !body.trim()) return;
    mutation.mutate({ from, body }, { onSuccess: () => setBody('') });
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <Input
        aria-label="From number"
        value={from}
        onChange={(e) => setFrom(e.target.value)}
        placeholder="+15555550123"
      />
      <Input
        aria-label="Message body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Type an inbound message…"
      />
      <Button type="submit" disabled={mutation.isPending || !from.trim() || !body.trim()}>
        {mutation.isPending ? 'Sending…' : 'Simulate inbound'}
      </Button>
      {mutation.isError && <p className="text-xs text-destructive">Failed to simulate.</p>}
    </form>
  );
}
