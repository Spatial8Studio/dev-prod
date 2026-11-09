clear;
clc;

% Input and output files
inputFile = "input.mp3";
outputFile = "spatial_output.mp3";

% Earphone coordinates [x y z]
% +Y = Left Earphone
% -Y = Right Earphone
%  0 = Center (Both Earphones Balanced)
% +X = Forward baseline distance (1.0m)
%  Z = Elevation (0, bypassed for 2-earphone rendering)
sourcePosition = [1.0 1.5 0.0]; % 1.5m toward Left Earphone

% Process audio using the two-factor Left/Right earphone model (ITD + ILD)
metadata = spatializeAudio( ...
    inputFile, ...
    outputFile, ...
    sourcePosition, ...
    'AllowSynthetic', true, ...
    'FfmpegPath', "ffmpeg", ...
    'Mp3Bitrate', "320k");

disp("Left/Right earphone spatial audio processing completed.");
disp(metadata);
