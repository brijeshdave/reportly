// Author: Brijesh Dave <https://github.com/brijeshdave>
// The shape of an outgoing email, on its own so a transport can import it without
// importing the SMTP mailer — which would build a nodemailer transport just to
// read a type.
export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}
