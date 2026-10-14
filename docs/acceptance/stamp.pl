#!/usr/bin/perl
# Puts the UTC time, to the millisecond, in front of every line it reads, the moment the line arrives:
#   node ... start 2>&1 | perl docs/acceptance/stamp.pl
# check.sql prints database times in UTC too, so the two can be compared.
use strict;
use warnings;
use POSIX qw(strftime);
use Time::HiRes qw(gettimeofday);

$| = 1;
while (my $line = <STDIN>) {
    my ($seconds, $microseconds) = gettimeofday;
    printf "%s.%03d %s", strftime('%H:%M:%S', gmtime $seconds), $microseconds / 1000, $line;
}
