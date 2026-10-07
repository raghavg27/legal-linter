import { Heading, Html, Text } from '@react-email/components';
import { EmailFooter } from './components/footer';

export default function WeeklyDigest({ name, unsubscribeUrl }: { name: string; unsubscribeUrl: string }) {
  return (
    <Html>
      <Heading>This week at Acme</Heading>
      <Text>Hi {name}, here are the three posts our readers liked most.</Text>
      <EmailFooter unsubscribeUrl={unsubscribeUrl} />
    </Html>
  );
}
