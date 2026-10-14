function metadata = spatializeAudio(inputFile, outputFile, xyz, varargin)
%SPATIALIZEAUDIO HRTF-based 3-D binaural MP3 renderer.
%
% Example:
% metadata = spatializeAudio( ...
%     "input.mp3", ...
%     "output.mp3", ...
%     [2 1 0.5], ...
%     'AllowSynthetic', true);

%% Default settings

hrirFile = "";
subjectName = "";
ffmpegPath = "ffmpeg";
maxDistance = 1;
referenceDistance = 1;
speedOfSound = 343;
headRadius = 0.0875;
applyExtraITD = false;
allowSynthetic = false;
normalizeOutput = true;
mp3Bitrate = "320k";

%% Read name-value options

if mod(length(varargin), 2) ~= 0
    error("Options must be supplied as name-value pairs.");
end

for k = 1:2:length(varargin)

    optionName = lower(string(varargin{k}));
    optionValue = varargin{k + 1};

    switch optionName

        case "hrirfile"
            hrirFile = string(optionValue);

        case "subject"
            subjectName = string(optionValue);

        case "ffmpegpath"
            ffmpegPath = string(optionValue);

        case "maxdistance"
            maxDistance = double(optionValue);

        case "referencedistance"
            referenceDistance = double(optionValue);

        case "speedofsound"
            speedOfSound = double(optionValue);

        case "headradius"
            headRadius = double(optionValue);

        case "applyextraitd"
            applyExtraITD = logical(optionValue);

        case "allowsynthetic"
            allowSynthetic = logical(optionValue);

        case "normalize"
            normalizeOutput = logical(optionValue);

        case "mp3bitrate"
            mp3Bitrate = string(optionValue);

        otherwise
            error("Unknown option: " + optionName);
    end
end

%% Validate input

if length(xyz) ~= 3
    error("xyz must contain exactly three values: [x y z].");
end

if norm(xyz) == 0
    error("The source position cannot be [0 0 0].");
end

if ~isfile(inputFile)
    error("Input audio file not found: " + inputFile);
end

%% Read MP3 or WAV input

[source, sampleRate] = audioread(inputFile);

if isempty(source)
    error("Input audio file is empty.");
end

% Convert stereo input into mono.
if size(source, 2) > 1
    source = mean(source, 2);
end

source = double(source(:));

%% Calculate spatial parameters

distance = norm(xyz);

% Coordinate convention:
% +X = forward
% +Y = left
% +Z = upward

azimuth = atan2d(xyz(2), xyz(1));
elevation = asind(xyz(3) / distance);

% Inverse-distance attenuation
distanceGain = min(1, maxDistance / ...
    max(distance, referenceDistance));

%% Load measured HRIR data

[hrirLeft, hrirRight, hrirSampleRate, directionInfo] = ...
    loadHrir(hrirFile, subjectName);

if ~isempty(hrirSampleRate) && hrirSampleRate ~= sampleRate
    error("Input and HRIR sample rates must be equal.");
end

%% Select HRIR

if isempty(hrirLeft)

    if ~allowSynthetic
        error([ ...
            "No HRIR file was provided. Use " + ...
            "'HrirFile','your_hrir_file.mat' or set " + ...
            "'AllowSynthetic',true."]);
    end

    % Testing-only synthetic HRIR
    [hrirLeft, hrirRight] = createSyntheticHrir( ...
        sampleRate, azimuth, speedOfSound, headRadius);

    selectedDirection = NaN;
    selectedAzimuth = azimuth;
    selectedElevation = elevation;

else

    [selectedDirection, selectedAzimuth, selectedElevation] = ...
        selectNearestDirection(directionInfo, azimuth, elevation);

    hrirLeft = hrirLeft(:, selectedDirection);
    hrirRight = hrirRight(:, selectedDirection);
end

%% Optional ITD

if applyExtraITD

    itdSeconds = headRadius / speedOfSound * ...
        (deg2rad(azimuth) + sind(azimuth));

    if itdSeconds > 0

        hrirLeft = [hrirLeft; zeros(round(itdSeconds * sampleRate), 1)];
        hrirRight = fractionalDelay( ...
            hrirRight, itdSeconds * sampleRate);

    elseif itdSeconds < 0

        hrirLeft = fractionalDelay( ...
            hrirLeft, -itdSeconds * sampleRate);

        hrirRight = [ ...
            hrirRight; zeros(round(-itdSeconds * sampleRate), 1)];
    end
end

% Equalize filter lengths
filterLength = max(length(hrirLeft), length(hrirRight));

hrirLeft(end+1:filterLength, 1) = 0;
hrirRight(end+1:filterLength, 1) = 0;

%% FIR convolution

leftAudio = conv(source, hrirLeft) * distanceGain;
rightAudio = conv(source, hrirRight) * distanceGain;

binauralAudio = [leftAudio, rightAudio];

%% Normalize

if normalizeOutput

    peakValue = max(abs(binauralAudio(:)));

    if peakValue > 0
        binauralAudio = 0.98 * binauralAudio / peakValue;
    end
end

%% Write temporary WAV

temporaryWav = outputFile + ".temporary.wav";

audiowrite( ...
    temporaryWav, ...
    binauralAudio, ...
    sampleRate, ...
    "BitsPerSample", 24);

%% Convert WAV to MP3 using FFmpeg

command = sprintf( ...
    '"%s" -y -i "%s" -codec:a libmp3lame -b:a %s "%s"', ...
    ffmpegPath, ...
    temporaryWav, ...
    mp3Bitrate, ...
    outputFile);

[status, commandOutput] = system(command);

if status ~= 0

    if isfile(temporaryWav)
        delete(temporaryWav);
    end

    error("FFmpeg conversion failed:" + newline + commandOutput);
end

%% Delete temporary WAV

if isfile(temporaryWav)
    delete(temporaryWav);
end

%% Return metadata

metadata = struct( ...
    "inputFile", inputFile, ...
    "outputFile", outputFile, ...
    "sampleRate", sampleRate, ...
    "distanceMetres", distance, ...
    "azimuthDegrees", azimuth, ...
    "elevationDegrees", elevation, ...
    "distanceGain", distanceGain, ...
    "selectedHrirDirection", selectedDirection, ...
    "selectedHrirAzimuth", selectedAzimuth, ...
    "selectedHrirElevation", selectedElevation, ...
    "outputFormat", "MP3", ...
    "mp3Bitrate", mp3Bitrate);

end


%% ========================================================================
function [left, right, fs, directionInfo] = loadHrir(fileName, subjectName)

left = [];
right = [];
fs = [];

directionInfo = struct( ...
    "azimuth", [], ...
    "elevation", []);

if strlength(fileName) == 0
    return;
end

if ~isfile(fileName)
    error("HRIR file not found: " + fileName);
end

data = load(fileName);
names = fieldnames(data);
subject = [];

% Explicit subject name
if strlength(subjectName) > 0 && isfield(data, char(subjectName))

    subject = data.(char(subjectName));

% Generic file
elseif isfield(data, "hrirL") || isfield(data, "hrir_l")

    subject = data;

% Automatically search for CIPIC subject structure
else

    for k = 1:length(names)

        candidate = data.(names{k});

        if isstruct(candidate) && ...
                (isfield(candidate, "hrir_l") || ...
                 isfield(candidate, "hrirL"))

            subject = candidate;
            break;
        end
    end
end

if isempty(subject)
    error("Unsupported HRIR MAT file.");
end

%% Read HRIR arrays

left = getField(subject, {"hrirL", "hrir_l", "left"});
right = getField(subject, {"hrirR", "hrir_r", "right"});

if isempty(left) || isempty(right)
    error("Both left and right HRIR arrays are required.");
end

if ~isequal(size(left), size(right))
    error("Left and right HRIR arrays must have equal dimensions.");
end

%% Read directions

azimuthGrid = getField(subject, ...
    {"azimuth", "azimuths", "SourceAzimuth", "azim_v"});

elevationGrid = getField(subject, ...
    {"elevation", "elevations", "SourceElevation", "elev_v"});

if isempty(azimuthGrid) || isempty(elevationGrid)
    error("HRIR azimuth and elevation arrays are required.");
end

azimuthGrid = double(azimuthGrid(:));
elevationGrid = double(elevationGrid(:));

%% Convert CIPIC format

% CIPIC format:
% [azimuth x elevation x samples]

if ndims(left) == 3

    if size(left, 1) ~= length(azimuthGrid) || ...
            size(left, 2) ~= length(elevationGrid)

        error([ ...
            "3-D HRIR arrays must use format " ...
            "[azimuth x elevation x samples]."]);
    end

    left = reshape( ...
        permute(left, [3 1 2]), ...
        size(left, 3), []);

    right = reshape( ...
        permute(right, [3 1 2]), ...
        size(right, 3), []);

    [azimuthMatrix, elevationMatrix] = ...
        ndgrid(azimuthGrid, elevationGrid);

    directionInfo.azimuth = azimuthMatrix(:);
    directionInfo.elevation = elevationMatrix(:);

else

    % Format [samples x directions]
    if size(left, 2) == length(azimuthGrid)

        % Already correct.

    % Format [directions x samples]
    elseif size(left, 1) == length(azimuthGrid)

        left = left.';
        right = right.';

    else
        error("HRIR direction count does not match direction arrays.");
    end

    directionInfo.azimuth = azimuthGrid;
    directionInfo.elevation = elevationGrid;
end

%% Read HRIR sample rate

sampleRate = getField(subject, ...
    {"fs", "Fs", "samplingRate", "sampleRate"});

if ~isempty(sampleRate)
    fs = double(sampleRate);
end

end


%% ========================================================================
function value = getField(data, fieldNames)

value = [];

for k = 1:length(fieldNames)

    if isfield(data, fieldNames{k})
        value = data.(fieldNames{k});
        return;
    end
end

end


%% ========================================================================
function [index, selectedAzimuth, selectedElevation] = ...
    selectNearestDirection(info, targetAzimuth, targetElevation)

azimuthDifference = mod( ...
    info.azimuth - targetAzimuth + 180, 360) - 180;

elevationDifference = ...
    info.elevation - targetElevation;

angularDistance = hypot( ...
    azimuthDifference, elevationDifference);

[~, index] = min(angularDistance);

selectedAzimuth = info.azimuth(index);
selectedElevation = info.elevation(index);

end


%% ========================================================================
function [left, right] = createSyntheticHrir( ...
    fs, azimuth, speedOfSound, headRadius)

% Testing-only HRIR.
% Use a measured HRIR database for final results.

itd = headRadius / speedOfSound * ...
    (deg2rad(azimuth) + sind(azimuth));

baseImpulse = [1; 0.15; 0.05];

left = baseImpulse;
right = baseImpulse;

levelDifference = ...
    10^(min(6, abs(azimuth) / 90 * 6) / 20);

if itd > 0

    right = fractionalDelay(right, itd * fs);
    left = left * levelDifference;

else

    left = fractionalDelay(left, -itd * fs);
    right = right * levelDifference;
end

end


%% ========================================================================
function delayed = fractionalDelay(signal, delaySamples)

integerDelay = floor(delaySamples);
fraction = delaySamples - integerDelay;

delayed = [zeros(integerDelay, 1); signal];

if fraction > 0

    delayed = [delayed; 0];

    delayed = ...
        (1 - fraction) * delayed + ...
        fraction * [0; delayed(1:end-1)];
end

end
