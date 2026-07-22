import { EmailType } from '../../generated/prisma/enums';

export interface EmailVariables {
  candidateName?: string | null;
  jobTitle: string;
  /** Deadline to complete the AI technical interview (INTERVIEW_ACKNOWLEDGEMENT). */
  interviewDeadline?: Date;
  /** HR-provided date/time for a further human interview round (NEXT_ROUND). */
  nextRoundTime?: Date;
  /** HR-provided deadline to respond/schedule the next round (NEXT_ROUND). */
  nextRoundDeadline?: Date;
}

export interface EmailContent {
  subject: string;
  html: string;
}

function greet(name: string | null | undefined): string {
  return name ? `Dear ${name},` : 'Dear Candidate,';
}

function wrap(bodyHtml: string): string {
  return `<div style="font-family: Arial, sans-serif; font-size: 15px; line-height: 1.6; color: #1a1a1a;">${bodyHtml}<p>Best regards,<br/>AI Recruitment Pipeline</p></div>`;
}

function formatDateTime(value: Date | undefined): string {
  return value
    ? value.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })
    : 'to be confirmed';
}

export function buildEmail(type: EmailType, v: EmailVariables): EmailContent {
  switch (type) {
    case 'SCREENING_REJECTION':
      return {
        subject: `Update on your application for ${v.jobTitle}`,
        html: wrap(`
          <p>${greet(v.candidateName)}</p>
          <p>Thank you for applying for the <strong>${v.jobTitle}</strong> position and for taking the time to share your background with us.</p>
          <p>After careful review, we've decided not to move forward with your application at this time. This decision reflects the specific requirements of this role rather than your overall qualifications, and we encourage you to apply for future openings that match your experience.</p>
          <p>We wish you the best in your job search.</p>
        `),
      };

    case 'INTERVIEW_ACKNOWLEDGEMENT':
      return {
        subject: `You're invited to a short technical interview for ${v.jobTitle}`,
        html: wrap(`
          <p>${greet(v.candidateName)}</p>
          <p>Congratulations — your application for the <strong>${v.jobTitle}</strong> position has passed our initial screening.</p>
          <p>The next step is a short, AI-conducted technical interview. It's quick, conversational, and can be completed from wherever you are.</p>
          <p>Please complete it before <strong>${formatDateTime(v.interviewDeadline)}</strong>. If you have any trouble accessing it, reply to this email and our team will assist you.</p>
        `),
      };

    case 'SELECTION':
      return {
        subject: `Great news about your application for ${v.jobTitle}`,
        html: wrap(`
          <p>${greet(v.candidateName)}</p>
          <p>We're pleased to let you know that you've been selected for the <strong>${v.jobTitle}</strong> position. Congratulations!</p>
          <p>Our team will be in touch shortly with the next steps.</p>
        `),
      };

    case 'NEXT_ROUND':
      return {
        subject: `Next round for your application: ${v.jobTitle}`,
        html: wrap(`
          <p>${greet(v.candidateName)}</p>
          <p>Thank you for completing the technical interview for the <strong>${v.jobTitle}</strong> position — we'd like to invite you to a further interview round.</p>
          <p><strong>Proposed time:</strong> ${formatDateTime(v.nextRoundTime)}</p>
          <p><strong>Please confirm/respond by:</strong> ${formatDateTime(v.nextRoundDeadline)}</p>
          <p>Reply to this email to confirm your availability or request an alternate time.</p>
        `),
      };

    case 'REJECTION':
      return {
        subject: `Update on your application for ${v.jobTitle}`,
        html: wrap(`
          <p>${greet(v.candidateName)}</p>
          <p>Thank you for the time and effort you invested throughout the interview process for the <strong>${v.jobTitle}</strong> position.</p>
          <p>After careful consideration, we've decided to move forward with another candidate. This was a competitive process, and this outcome doesn't diminish the strength of your background.</p>
          <p>We'd welcome your application for future roles that fit your experience.</p>
        `),
      };

    case 'BULK_REJECTION':
      return {
        subject: `Update on your application for ${v.jobTitle}`,
        html: wrap(`
          <p>${greet(v.candidateName)}</p>
          <p>Thank you for your interest in the <strong>${v.jobTitle}</strong> position, which is now closed.</p>
          <p>We've decided not to move forward with your application for this particular role, and encourage you to apply again in the future.</p>
        `),
      };
  }
}
