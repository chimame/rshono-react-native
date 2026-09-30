import { fireEvent, render, screen } from "@testing-library/react-native";
import { Counter, Label, Panel } from "./native-host";

test("renders received components as native UI with working interactions", () => {
  render(
    <Panel>
      <Label>Text from the server</Label>
      <Counter />
    </Panel>,
  );
  expect(screen.getByText("Text from the server")).toBeTruthy();
  fireEvent.press(screen.getByLabelText("Increment local counter"));
  expect(screen.getByText("Local counter: 1")).toBeTruthy();
});
