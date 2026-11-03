function metadata = renderScene(sources, outputFile, varargin)
%RENDERSCENE Render multiple moving sources and sum them into one MP3.
% Each source has inputFile, startPosition, destinationPosition, travelTime.
ffmpegPath = "ffmpeg";
hrirFile = "";
allowSynthetic = true;
for k = 1:2:length(varargin)
    optionName = lower(string(varargin{k}));
    if optionName == "ffmpegpath", ffmpegPath = string(varargin{k+1}); end
    if optionName == "hrirfile", hrirFile = string(varargin{k+1}); end
    if optionName == "allowsynthetic", allowSynthetic = logical(varargin{k+1}); end
end
if isempty(sources), error("At least one source is required."); end
work = string(outputFile) + ".sources";
if ~isfolder(work), mkdir(work); end
mixed = [];
sampleRate = [];
for k = 1:numel(sources)
    sourceOutput = fullfile(work, sprintf("source_%03d.mp3", k));
    sourceMetadata = spatializeAudio(sources(k).inputFile, sourceOutput, sources(k).startPosition, ...
        "EndPosition", sources(k).destinationPosition, ...
        "TravelTime", sources(k).travelTime, ...
        "AllowSynthetic", allowSynthetic, "HrirFile", hrirFile, ...
        "FfmpegPath", ffmpegPath);
    if k == 1
        disp("SPATIA_DIRECTIONAL_CUES=measured-lateral-hrtf+front-rear-height-enhancement");
        disp("SPATIA_ELEVATION_CUE_STRENGTH=" + string(sourceMetadata.elevationCueStrength));
    end
    [audio, rate] = audioread(sourceOutput);
    if isempty(sampleRate), sampleRate = rate; end
    if rate ~= sampleRate, error("All source sample rates must match."); end
    if size(audio, 2) == 1, audio = [audio audio]; end
    if isempty(mixed), mixed = zeros(size(audio)); end
    if size(audio, 1) > size(mixed, 1), mixed(end+1:size(audio,1), :) = 0; end
    mixed(1:size(audio,1), :) = mixed(1:size(audio,1), :) + audio;
end
peak = max(abs(mixed(:)));
if peak > 0, mixed = 0.98 * mixed / max(peak, 1); end
temporaryWav = string(outputFile) + ".temporary.wav";
audiowrite(temporaryWav, mixed, sampleRate, "BitsPerSample", 24);
if isfile(outputFile), delete(outputFile); end
command = sprintf('"%s" -y -i "%s" -codec:a libmp3lame -b:a 320k "%s"', ffmpegPath, temporaryWav, outputFile);
[status, result] = system(command);
if status ~= 0, error("FFmpeg failed: " + string(result)); end
delete(temporaryWav);
metadata.outputFile = outputFile;
metadata.sourceCount = numel(sources);
metadata.sampleRate = sampleRate;
end
