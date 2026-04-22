export function ProgressBar(props: { value: number }) {
  return (
    <div class="w-full h-1.5 bg-[#0f1a2b] rounded-full overflow-hidden">
      <div
        class="h-full bg-gradient-to-r from-emerald-400 to-emerald-500 transition-all duration-300 rounded-full shadow-[0_0_10px_rgba(16,185,129,0.5)]"
        style={{ width: `${props.value}%` }}
      />
    </div>
  );
}
