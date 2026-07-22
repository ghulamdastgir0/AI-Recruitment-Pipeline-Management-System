import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DecideApplicationDto } from './decide-application.dto';

async function validateDto(input: Record<string, unknown>) {
  const dto = plainToInstance(DecideApplicationDto, input);
  return validate(dto);
}

describe('DecideApplicationDto', () => {
  it('passes for SELECTED with no time fields', async () => {
    const errors = await validateDto({ decision: 'SELECTED' });
    expect(errors).toHaveLength(0);
  });

  it('passes for REJECTED with no time fields', async () => {
    const errors = await validateDto({ decision: 'REJECTED' });
    expect(errors).toHaveLength(0);
  });

  it('fails for NEXT_ROUND without nextRoundTime/nextRoundDeadline', async () => {
    const errors = await validateDto({ decision: 'NEXT_ROUND' });
    const properties = errors.map((e) => e.property);
    expect(properties).toEqual(
      expect.arrayContaining(['nextRoundTime', 'nextRoundDeadline']),
    );
  });

  it('passes for NEXT_ROUND with valid ISO time fields', async () => {
    const errors = await validateDto({
      decision: 'NEXT_ROUND',
      nextRoundTime: '2026-08-05T14:00:00.000Z',
      nextRoundDeadline: '2026-08-08T23:59:00.000Z',
    });
    expect(errors).toHaveLength(0);
  });

  it('fails for an unrecognized decision value', async () => {
    const errors = await validateDto({ decision: 'MAYBE' });
    expect(errors.some((e) => e.property === 'decision')).toBe(true);
  });
});
