import SettingsForm from "@/components/SettingsForm";
import BackButton from "@/components/BackButton";

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <BackButton />
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="mt-1 text-sm text-slate-400">
          Configure SignalWire SMS, Firebase push notifications, and the missed-call voicemail flow.
        </p>
      </div>
      <SettingsForm />
    </div>
  );
}
