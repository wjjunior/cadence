import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderWithClient } from '@/test/render';

import { StatusBadge } from './ui';

describe('StatusBadge', () => {
  it('should reveal error_detail in a tooltip on a failed message', async () => {
    renderWithClient(<StatusBadge status="failed" errorDetail="provider down" />);

    await userEvent.hover(screen.getByText('failed'));

    expect(await screen.findAllByText('provider down')).not.toHaveLength(0);
  });

  it('should render a plain badge for a non-failed status', () => {
    renderWithClient(<StatusBadge status="sent" errorDetail={null} />);

    expect(screen.getByText('sent')).toBeInTheDocument();
  });
});
