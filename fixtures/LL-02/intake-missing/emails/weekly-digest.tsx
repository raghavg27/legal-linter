import { Heading, Html, Text } from '@react-email/components';

export default function WeeklyDigest({ name }: { name: string }) {
  return (
    <Html>
      <Heading>This week at Acme</Heading>
      <Text>Hi {name}, here are the three posts our readers liked most.</Text>
    </Html>
  );
}
