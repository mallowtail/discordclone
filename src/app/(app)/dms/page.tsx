export default function DmHome() {
  return (
    <div className="flex-1 flex items-center justify-center text-muted p-8 text-center">
      <div>
        <p className="text-lg text-ink mb-1">No conversation open</p>
        <p className="text-sm">
          Pick a server on the left, add one with the add-server button, or start a direct message.
        </p>
      </div>
    </div>
  );
}
